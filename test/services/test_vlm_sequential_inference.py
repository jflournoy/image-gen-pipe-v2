"""
TDD RED Phase: Test VLM service stability during sequential inference

The VLM service crashes during ensemble voting because multiple sequential
/compare calls cause GGML buffer accumulation or KV cache corruption.

This test verifies:
1. Sequential inference calls don't crash the service
2. Memory cleanup happens between inferences
3. KV cache is properly cleared (not destructively reset)
4. Inference count tracking triggers preventive model reload
"""

import pytest
import asyncio
import gc
from unittest.mock import Mock, patch, MagicMock
import time


class TestSequentialInferenceStability:
    """Tests that the VLM service handles multiple sequential inferences without crashing"""

    @pytest.fixture
    def mock_llm(self):
        """Create a mock LLM that simulates sequential inference behavior"""
        mock = Mock()
        mock.call_count = 0
        mock.reset_called = 0
        mock.kv_cache_clear_called = 0

        def track_inference(*args, **kwargs):
            mock.call_count += 1
            return {
                'choices': [{
                    'message': {
                        'content': '{"choice": "A", "explanation": "test", "confidence": 0.8, '
                                   '"ranks": {"A": {"alignment": 1, "aesthetics": 1}, "B": {"alignment": 2, "aesthetics": 2}}, '
                                   '"winner_strengths": ["good"], "loser_weaknesses": ["bad"], '
                                   '"improvement_suggestion": "improve"}'
                    }
                }]
            }

        def track_reset():
            mock.reset_called += 1

        def track_kv_clear():
            mock.kv_cache_clear_called += 1

        mock.create_chat_completion = track_inference
        mock.reset = track_reset
        mock.kv_cache_clear = track_kv_clear
        return mock

    def test_reset_kv_cache_prefers_kv_cache_clear(self, mock_llm):
        """
        KV cache reset should prefer kv_cache_clear() over reset().

        llm.reset() is destructive and can crash in some llama-cpp-python versions.
        kv_cache_clear() only zeros out the cache without reallocating, which is safer.
        """
        from services.vlm_service import reset_kv_cache

        with patch('services.vlm_service.llm', mock_llm):
            reset_kv_cache()

            # Should prefer kv_cache_clear over reset
            assert mock_llm.kv_cache_clear_called == 1, (
                "reset_kv_cache() should call kv_cache_clear() (safer) instead of reset() (destructive)"
            )
            assert mock_llm.reset_called == 0, (
                "reset_kv_cache() should NOT call reset() — it can crash llama-cpp-python"
            )

    def test_reset_kv_cache_falls_back_to_reset(self, mock_llm):
        """If kv_cache_clear() is not available, fall back to reset()"""
        from services.vlm_service import reset_kv_cache

        # Remove kv_cache_clear to simulate older llama-cpp-python
        del mock_llm.kv_cache_clear
        mock_llm.kv_cache_clear_called = None

        with patch('services.vlm_service.llm', mock_llm):
            reset_kv_cache()

            assert mock_llm.reset_called == 1, (
                "Should fall back to reset() when kv_cache_clear() is unavailable"
            )

    def test_inference_triggers_gc_cleanup(self, mock_llm):
        """
        Each inference should trigger garbage collection to prevent memory accumulation.

        During ensemble voting, multiple sequential inferences run without model unload.
        Without explicit GC, Python objects holding GGML buffer references accumulate.
        """
        from services.vlm_service import run_inference_with_retry

        messages = [{"role": "user", "content": "test"}]

        gc_calls = []
        original_collect = gc.collect

        def track_gc(*args, **kwargs):
            gc_calls.append(time.monotonic())
            return original_collect(*args, **kwargs)

        with patch('services.vlm_service.llm', mock_llm):
            with patch('services.vlm_service.gc.collect', track_gc):
                # Run 3 sequential inferences (simulating ensemble voting)
                for _ in range(3):
                    run_inference_with_retry(mock_llm, messages, max_tokens=500, temperature=0.1)

        # Should have called gc.collect at least once per inference
        # (reset_kv_cache triggers it, plus post-inference cleanup)
        assert len(gc_calls) >= 3, (
            f"Expected at least 3 gc.collect() calls for 3 inferences, got {len(gc_calls)}. "
            "Sequential inferences need explicit GC to prevent GGML buffer accumulation."
        )

    def test_inference_count_tracking(self, mock_llm):
        """
        Service should track inference count and support preventive model reload.

        After many sequential inferences, GGML memory fragmentation can cause crashes.
        A configurable threshold triggers model reload as a safety valve.
        """
        from services import vlm_service

        # Check that inference_count tracking exists
        assert hasattr(vlm_service, 'inference_count'), (
            "VLM service should track inference_count for preventive reload"
        )

    @pytest.mark.asyncio
    async def test_sequential_compare_requests_dont_crash(self, mock_llm):
        """
        Simulate ensemble voting: 3 sequential /compare requests.

        This is the core crash scenario. The VLM service must handle
        multiple sequential inference calls without crashing.
        """
        with patch('services.vlm_service.load_model', return_value=mock_llm):
            with patch('services.vlm_service.llm', mock_llm):
                with patch('services.vlm_service.encode_image', return_value='data:image/png;base64,test'):
                    from services.vlm_service import app
                    from httpx import AsyncClient, ASGITransport

                    transport = ASGITransport(app=app)
                    async with AsyncClient(transport=transport, base_url='http://test') as client:
                        # Sequential requests (like ensemble voting)
                        for i in range(3):
                            resp = await client.post('/compare', json={
                                'image_a': '/tmp/test_a.png',
                                'image_b': '/tmp/test_b.png',
                                'prompt': 'test prompt'
                            })
                            assert resp.status_code == 200, (
                                f"Sequential request {i+1}/3 failed with status {resp.status_code}: {resp.text}"
                            )

                        # All 3 should succeed
                        assert mock_llm.call_count == 3, (
                            f"Expected 3 inference calls (ensemble size 3), got {mock_llm.call_count}"
                        )

    @pytest.mark.asyncio
    async def test_compare_batch_endpoint_exists(self):
        """
        VLM service should have a /compare-batch endpoint for efficient ensemble voting.

        Instead of N separate HTTP round-trips, the client can send a batch request.
        This reduces overhead and allows the service to manage memory between comparisons.
        """
        from services.vlm_service import app

        # Check that /compare-batch route exists
        routes = [route.path for route in app.routes]
        assert '/compare-batch' in routes, (
            "VLM service should expose /compare-batch endpoint for efficient ensemble voting. "
            "This avoids N HTTP round-trips and lets the service manage memory between comparisons."
        )


class TestPostInferenceCleanup:
    """Tests for memory cleanup after inference completes"""

    @pytest.fixture
    def mock_llm(self):
        mock = Mock()
        mock.create_chat_completion = Mock(return_value={
            'choices': [{
                'message': {
                    'content': '{"choice": "A", "explanation": "test", "confidence": 0.8}'
                }
            }]
        })
        mock.kv_cache_clear = Mock()
        mock.reset = Mock()
        return mock

    def test_cuda_cache_cleared_after_inference(self, mock_llm):
        """
        CUDA cache should be cleared after inference to prevent VRAM accumulation.

        Each CLIP image processing allocates GPU tensors. Without explicit
        torch.cuda.empty_cache(), these accumulate across sequential inferences.
        """
        from services.vlm_service import run_inference_with_retry

        messages = [{"role": "user", "content": "test"}]
        cuda_clears = []

        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        mock_torch.cuda.empty_cache = lambda: cuda_clears.append(1)

        with patch('services.vlm_service.llm', mock_llm):
            with patch.dict('sys.modules', {'torch': mock_torch}):
                run_inference_with_retry(mock_llm, messages, max_tokens=500, temperature=0.1)

        assert len(cuda_clears) >= 1, (
            "Should call torch.cuda.empty_cache() after inference to prevent VRAM accumulation"
        )


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
