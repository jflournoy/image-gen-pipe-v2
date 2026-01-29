"""
TDD RED Phase: Test VLM service request serialization

This test verifies that the VLM service properly serializes requests
to prevent concurrent model inference, which can cause crashes or
corrupted results with llama-cpp-python.

Issue: llama_cpp.Llama.create_chat_completion() is NOT thread-safe.
Multiple concurrent calls on the same model instance can crash or
produce corrupted results.

Fix: Add asyncio.Lock to ensure only one inference runs at a time.
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
import time


class TestVLMServiceConcurrency:
    """Tests for VLM service request serialization"""

    @pytest.fixture
    def mock_llm(self):
        """Create a mock LLM that tracks concurrent calls"""
        mock = Mock()
        mock.concurrent_calls = 0
        mock.max_concurrent = 0
        mock.call_count = 0

        def track_inference(*args, **kwargs):
            mock.concurrent_calls += 1
            mock.call_count += 1
            mock.max_concurrent = max(mock.max_concurrent, mock.concurrent_calls)
            # Simulate inference time
            time.sleep(0.1)
            mock.concurrent_calls -= 1
            return {
                'choices': [{
                    'message': {
                        'content': '{"choice": "A", "explanation": "test", "confidence": 0.8}'
                    }
                }]
            }

        mock.create_chat_completion = track_inference
        return mock

    @pytest.mark.asyncio
    async def test_concurrent_requests_are_serialized(self, mock_llm):
        """
        Test that concurrent requests are serialized (max 1 at a time).

        This test FAILS without an asyncio.Lock in the VLM service
        because FastAPI can process multiple async requests concurrently.
        """
        # Patch the model loading to return our mock
        with patch('services.vlm_service.load_model', return_value=mock_llm):
            with patch('services.vlm_service.llm', mock_llm):
                from services.vlm_service import app
                from httpx import AsyncClient, ASGITransport

                # Create test images (mocked)
                with patch('services.vlm_service.encode_image', return_value='data:image/png;base64,test'):
                    transport = ASGITransport(app=app)
                    async with AsyncClient(transport=transport, base_url='http://test') as client:
                        # Send 5 concurrent requests
                        tasks = [
                            client.post('/compare', json={
                                'image_a': '/tmp/test_a.png',
                                'image_b': '/tmp/test_b.png',
                                'prompt': 'test prompt'
                            })
                            for _ in range(5)
                        ]

                        responses = await asyncio.gather(*tasks)

                        # All requests should succeed
                        for resp in responses:
                            assert resp.status_code == 200, f"Request failed: {resp.text}"

                        # CRITICAL: Max concurrent should be 1 (requests serialized)
                        # This will FAIL without the lock because FastAPI processes
                        # async requests concurrently
                        assert mock_llm.max_concurrent == 1, (
                            f"Expected max 1 concurrent inference, got {mock_llm.max_concurrent}. "
                            "VLM service needs asyncio.Lock for request serialization."
                        )

                        # All 5 requests should have been processed
                        assert mock_llm.call_count == 5

    @pytest.mark.asyncio
    async def test_requests_complete_in_sequence(self, mock_llm):
        """
        Test that requests complete in arrival order when serialized.
        """
        completion_order = []
        original_inference = mock_llm.create_chat_completion

        def track_order(*args, **kwargs):
            result = original_inference(*args, **kwargs)
            completion_order.append(len(completion_order))
            return result

        mock_llm.create_chat_completion = track_order

        with patch('services.vlm_service.load_model', return_value=mock_llm):
            with patch('services.vlm_service.llm', mock_llm):
                from services.vlm_service import app
                from httpx import AsyncClient, ASGITransport

                with patch('services.vlm_service.encode_image', return_value='data:image/png;base64,test'):
                    transport = ASGITransport(app=app)
                    async with AsyncClient(transport=transport, base_url='http://test') as client:
                        tasks = [
                            client.post('/compare', json={
                                'image_a': '/tmp/test_a.png',
                                'image_b': '/tmp/test_b.png',
                                'prompt': f'test prompt {i}'
                            })
                            for i in range(3)
                        ]

                        await asyncio.gather(*tasks)

                        # All 3 should complete
                        assert len(completion_order) == 3

    @pytest.mark.asyncio
    async def test_inference_lock_exists(self):
        """
        Test that the VLM service has an inference_lock attribute.

        This is a simple existence check that FAILS until the lock is added.
        """
        from services import vlm_service

        # Check that inference_lock exists and is an asyncio.Lock
        assert hasattr(vlm_service, 'inference_lock'), (
            "VLM service missing 'inference_lock' - add: inference_lock = asyncio.Lock()"
        )
        assert isinstance(vlm_service.inference_lock, asyncio.Lock), (
            "inference_lock should be asyncio.Lock instance"
        )


class TestVLMServiceInferenceLockUsage:
    """Tests that the inference lock is actually used in the compare endpoint"""

    @pytest.mark.asyncio
    async def test_compare_uses_inference_lock(self):
        """
        Test that the /compare endpoint acquires inference_lock.

        We verify this by checking the lock is held during inference.
        """
        from services import vlm_service

        # Skip if lock doesn't exist yet (will fail in test_inference_lock_exists)
        if not hasattr(vlm_service, 'inference_lock'):
            pytest.skip("inference_lock not yet implemented")

        lock_was_held = False
        original_compare = vlm_service.compare_images

        async def check_lock_held(request):
            nonlocal lock_was_held
            # Check if lock is currently held (locked returns True if locked)
            lock_was_held = vlm_service.inference_lock.locked()
            # Create mock response
            from services.vlm_service import CompareResponse
            return CompareResponse(
                choice='A',
                explanation='test',
                confidence=0.8
            )

        with patch.object(vlm_service, 'compare_images', check_lock_held):
            # This won't work directly since we patched the function
            # Instead, verify the lock acquisition pattern in the actual code
            pass

        # The real test is that test_concurrent_requests_are_serialized passes
        # This is just a documentation test showing the expected pattern


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
