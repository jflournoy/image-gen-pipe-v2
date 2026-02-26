#!/usr/bin/env python3
"""
Local LLM Service using llama-cpp-python
FastAPI service for local language model inference using GGUF models
More memory-efficient than HuggingFace transformers
"""

import os
import gc
import time
import random
import json
import asyncio
import threading
from pathlib import Path
from typing import Optional, List
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Service configuration
PORT = int(os.getenv('LLM_PORT', '8003'))

# Model configuration - supports HuggingFace Hub or local path
# Example HuggingFace: "TheBloke/Mistral-7B-Instruct-v0.2-GGUF"
# Example local: "/path/to/model.gguf"
MODEL_REPO = os.getenv('LLM_MODEL_REPO', 'Mungert/Qwen3-8B-abliterated-GGUF')
MODEL_FILE = os.getenv('LLM_MODEL_FILE', '*q6_k_m.gguf')  # Glob pattern for model file
MODEL_PATH = os.getenv('LLM_MODEL_PATH', None)  # Override for local file path

# GPU layers: -1 = all layers on GPU, 0 = CPU only, N = N layers on GPU
# With 12GB VRAM: 28 layers leaves ~1.5GB headroom vs 32 layers to absorb
# CUDA memory fragmentation from repeated Flux↔VLM↔LLM model swaps
N_GPU_LAYERS = int(os.getenv('LLM_GPU_LAYERS', '28'))
N_CTX = int(os.getenv('LLM_CONTEXT_SIZE', '2048'))

# Global model reference and load lock (prevents parallel load races)
llm = None
_load_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    """Lifespan event handler for startup/shutdown"""
    print(f'[LLM Service] Starting on port {PORT}')
    if MODEL_PATH:
        print(f'[LLM Service] Model path: {MODEL_PATH}')
    else:
        print(f'[LLM Service] Model repo: {MODEL_REPO}')
        print(f'[LLM Service] Model file: {MODEL_FILE}')
    print(f'[LLM Service] GPU layers: {N_GPU_LAYERS}')
    print(f'[LLM Service] Context size: {N_CTX}')
    print('[LLM Service] OpenAI-compatible API at /v1/completions and /v1/chat/completions')
    yield
    # Cleanup on shutdown
    global llm
    if llm is not None:
        print('[LLM Service] Closing model...')
        llm.close()
        llm = None
        gc.collect()
    print('[LLM Service] Shutdown complete')


# Initialize FastAPI with lifespan
app = FastAPI(title='Local LLM Service (llama.cpp)', version='2.0.0', lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


class CompletionRequest(BaseModel):
    """LLM completion request (OpenAI-compatible format)"""
    model: str
    prompt: str
    max_tokens: int = 500
    temperature: float = 0.7
    top_p: float = 0.9
    top_k: int = 40
    repeat_penalty: float = 1.1
    stop: Optional[List[str]] = None
    stream: bool = False
    seed: Optional[int] = None


class CompletionResponse(BaseModel):
    """LLM completion response (OpenAI-compatible format)"""
    id: str
    object: str = "text_completion"
    created: int
    model: str
    choices: List[dict]
    usage: dict


class ChatMessage(BaseModel):
    """Single chat message"""
    role: str  # "system", "user", or "assistant"
    content: str


class ChatCompletionRequest(BaseModel):
    """Chat completion request (OpenAI-compatible format)"""
    model: str
    messages: List[ChatMessage]
    max_tokens: int = 500
    temperature: float = 0.7
    top_p: float = 0.9
    top_k: int = 40
    repeat_penalty: float = 1.1
    stop: Optional[List[str]] = None
    stream: bool = False
    seed: Optional[int] = None


class DownloadRequest(BaseModel):
    """Model download request"""
    repo_id: str = MODEL_REPO
    filename: str = MODEL_FILE


def _cuda_cleanup():
    """Force CUDA memory cleanup - call between retry attempts."""
    gc.collect()
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
    except ImportError:
        pass


def _try_load(gpu_layers):
    """Attempt a single model load with the given number of GPU layers."""
    from llama_cpp import Llama

    print(f'[LLM Service] Loading model...')
    print(f'[LLM Service] GPU layers: {gpu_layers}')

    if MODEL_PATH and Path(MODEL_PATH).exists():
        print(f'[LLM Service] Loading from local path: {MODEL_PATH}')
        return Llama(
            model_path=MODEL_PATH,
            n_ctx=N_CTX,
            n_gpu_layers=gpu_layers,
            verbose=False
        )
    else:
        print(f'[LLM Service] Loading from HuggingFace: {MODEL_REPO} / {MODEL_FILE}')
        return Llama.from_pretrained(
            repo_id=MODEL_REPO,
            filename=MODEL_FILE,
            n_ctx=N_CTX,
            n_gpu_layers=gpu_layers,
            verbose=False
        )


def load_model():
    """Load the LLM model using llama-cpp-python.

    Serializes concurrent load attempts with a lock (prevents races when
    multiple requests arrive simultaneously while llm is None).

    Retries with CUDA cleanup on context creation failure (caused by GPU
    memory fragmentation after repeated Flux↔VLM↔LLM swaps). Falls back to
    fewer GPU layers on second retry.
    """
    global llm

    # Fast path: already loaded (checked outside lock for performance)
    if llm is not None:
        return llm

    with _load_lock:
        # Re-check inside lock - another thread may have loaded while we waited
        if llm is not None:
            return llm

        try:
            from llama_cpp import Llama  # noqa: F401 (validates import once)
        except ImportError:
            raise RuntimeError(
                "llama-cpp-python not installed. Install with: "
                "pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121"
            )

        last_error = None

        # Attempt 1: configured GPU layers
        try:
            llm = _try_load(N_GPU_LAYERS)
        except Exception as e:
            last_error = e
            print(f'[LLM Service] Failed to load model: {e}')

            err_str = str(e).lower()
            is_memory_error = (
                'llama_context' in err_str or
                'context' in err_str or
                'failed to load model from file' in err_str or
                'out of memory' in err_str or
                'oom' in err_str
            )
            if not is_memory_error:
                raise  # Not a memory/GPU issue - don't retry

            # CUDA memory fragmentation: clean up and wait before retry
            print('[LLM Service] Context creation failed - cleaning CUDA memory, retrying in 3s...')
            _cuda_cleanup()
            time.sleep(3.0)

            # Attempt 2: same GPU layers after cleanup
            try:
                llm = _try_load(N_GPU_LAYERS)
                last_error = None
            except Exception as e2:
                last_error = e2
                print(f'[LLM Service] Retry 1 failed: {e2}')

                # Attempt 3: fewer GPU layers as fallback
                fallback_layers = max(1, N_GPU_LAYERS - 8)
                print(f'[LLM Service] Retrying with {fallback_layers} GPU layers (fallback)...')
                _cuda_cleanup()
                time.sleep(2.0)
                try:
                    llm = _try_load(fallback_layers)
                    last_error = None
                    print(f'[LLM Service] Loaded with fallback {fallback_layers} GPU layers')
                except Exception as e3:
                    last_error = e3
                    print(f'[LLM Service] All load attempts failed: {e3}')

        if last_error is not None:
            raise last_error

        # Get model info
        meta = getattr(llm, 'metadata', {}) or {}
        total_layers = (meta.get('n_layer') or
                       meta.get('n_layers') or
                       meta.get('llama.block_count') or
                       'unknown')

        print(f'[LLM Service] Model loaded successfully')
        print(f'[LLM Service] Total layers: {total_layers}, GPU layers: {N_GPU_LAYERS}')
        return llm


def unload_model():
    """Unload the model to free GPU memory.

    Aggressively cleans up GGML/CUDA resources to prevent fragmentation
    during repeated LLM↔Flux↔VLM model swaps (mirrors VLM service cleanup).
    """
    global llm
    if llm is not None:
        print('[LLM Service] Unloading model...')
        llm.close()
        llm = None
        gc.collect()
        gc.collect()  # Run twice to catch circular references
        # Synchronize CUDA to ensure cleanup completes before next model load
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()  # Wait for all CUDA ops to complete
                torch.cuda.empty_cache()  # Clear again after sync
        except ImportError:
            pass
        print('[LLM Service] Model unloaded, GPU memory freed')
        return True
    return False


@app.get('/health')
async def health_check():
    """Health check endpoint"""
    return {
        'status': 'healthy',
        'model_repo': MODEL_REPO,
        'model_file': MODEL_FILE,
        'model_path': MODEL_PATH,
        'gpu_layers': N_GPU_LAYERS,
        'context_size': N_CTX,
        'model_loaded': llm is not None
    }


@app.post('/load')
async def load_model_endpoint():
    """Explicitly load the model (for GPU coordination)"""
    try:
        load_model()
        return {
            'status': 'loaded',
            'model_repo': MODEL_REPO,
            'gpu_layers': N_GPU_LAYERS
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/unload')
async def unload_model_endpoint():
    """Explicitly unload the model to free GPU memory"""
    if unload_model():
        return {'status': 'unloaded', 'message': 'Model unloaded, GPU memory freed'}
    else:
        return {'status': 'not_loaded', 'message': 'Model was not loaded'}


@app.post('/v1/completions', response_model=CompletionResponse)
async def create_completion(request: CompletionRequest):
    """
    Generate text completion (OpenAI-compatible endpoint)
    Compatible with existing LocalLLMProvider
    """
    try:
        # Load model if not loaded
        model = load_model()

        prompt_preview = request.prompt[:80] + '...' if len(request.prompt) > 80 else request.prompt
        print(f'[LLM Service] Generating completion for: {prompt_preview}')

        # Set seed for reproducibility
        seed = request.seed if request.seed is not None else random.randint(0, 2**31 - 1)

        # Generate text
        start_time = time.time()
        result = model(
            request.prompt,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
            top_k=request.top_k,
            repeat_penalty=request.repeat_penalty,
            stop=request.stop or ["<|im_end|>", "<|endoftext|>", "<think>"],
            seed=seed
        )
        elapsed = time.time() - start_time

        generated_text = result["choices"][0]["text"]

        # Get token counts from result
        usage = result.get("usage", {})
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", len(generated_text.split()))

        print(f'[LLM Service] Generated {completion_tokens} tokens in {elapsed:.1f}s')

        # Format response in OpenAI format
        response = {
            'id': f'cmpl-{int(time.time())}',
            'object': 'text_completion',
            'created': int(time.time()),
            'model': request.model,
            'choices': [
                {
                    'text': generated_text,
                    'index': 0,
                    'logprobs': None,
                    'finish_reason': result["choices"][0].get("finish_reason", "stop")
                }
            ],
            'usage': {
                'prompt_tokens': prompt_tokens,
                'completion_tokens': completion_tokens,
                'total_tokens': prompt_tokens + completion_tokens
            }
        }

        return response

    except Exception as e:
        print(f'[LLM Service] Generation error: {e}')
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/v1/chat/completions')
async def create_chat_completion(request: ChatCompletionRequest):
    """
    Generate chat completion (OpenAI-compatible endpoint)
    Uses model's built-in chat template for proper message formatting.
    Appends /no_think to the last user message to disable Qwen3 thinking mode.
    """
    try:
        model = load_model()

        # Build messages list for llama-cpp-python
        messages = [{"role": m.role, "content": m.content} for m in request.messages]

        # Append /no_think to last user message to disable Qwen3 thinking mode.
        # Inside the chat template, this is properly formatted within <|im_start|>user
        # tokens where the model interprets it as a soft switch directive.
        for msg in reversed(messages):
            if msg["role"] == "user":
                if "/no_think" not in msg["content"]:
                    msg["content"] += " /no_think"
                break

        # Log preview of last user message
        last_user = next((m for m in reversed(messages) if m["role"] == "user"), None)
        if last_user:
            preview = last_user["content"][:80] + '...' if len(last_user["content"]) > 80 else last_user["content"]
            print(f'[LLM Service] Chat completion for: {preview}')

        seed = request.seed if request.seed is not None else random.randint(0, 2**31 - 1)

        start_time = time.time()
        result = model.create_chat_completion(
            messages=messages,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
            top_k=request.top_k,
            repeat_penalty=request.repeat_penalty,
            stop=request.stop or ["<|im_end|>", "<|endoftext|>"],
            seed=seed,
        )
        elapsed = time.time() - start_time

        # Extract response
        generated_text = result["choices"][0]["message"]["content"]
        usage = result.get("usage", {})
        completion_tokens = usage.get("completion_tokens", len(generated_text.split()))

        print(f'[LLM Service] Chat generated {completion_tokens} tokens in {elapsed:.1f}s')

        return {
            'id': f'chatcmpl-{int(time.time())}',
            'object': 'chat.completion',
            'created': int(time.time()),
            'model': request.model,
            'choices': [
                {
                    'index': 0,
                    'message': {
                        'role': 'assistant',
                        'content': generated_text
                    },
                    'finish_reason': result["choices"][0].get("finish_reason", "stop")
                }
            ],
            'usage': {
                'prompt_tokens': usage.get("prompt_tokens", 0),
                'completion_tokens': completion_tokens,
                'total_tokens': usage.get("prompt_tokens", 0) + completion_tokens
            }
        }

    except Exception as e:
        print(f'[LLM Service] Chat generation error: {e}')
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/v1/models')
async def list_models():
    """List available models (OpenAI-compatible endpoint)"""
    model_id = MODEL_PATH if MODEL_PATH else f"{MODEL_REPO}/{MODEL_FILE}"
    return {
        'object': 'list',
        'data': [
            {
                'id': model_id,
                'object': 'model',
                'created': int(time.time()),
                'owned_by': 'local'
            }
        ]
    }


@app.post('/download')
async def download_model_endpoint(request: DownloadRequest):
    """
    Download a GGUF model from HuggingFace Hub with progress streaming.
    Returns SSE stream with progress updates.
    """
    import fnmatch

    async def generate_progress():
        try:
            from huggingface_hub import hf_hub_download, HfApi, list_repo_files
            import threading

            yield f"data: {json.dumps({'status': 'started', 'message': f'Starting download of {request.repo_id}/{request.filename}...'})}\n\n"

            # Resolve glob pattern to actual filename
            actual_filename = request.filename
            if '*' in request.filename or '?' in request.filename:
                yield f"data: {json.dumps({'status': 'info', 'message': f'Searching for {request.filename} in {request.repo_id}...'})}\n\n"
                try:
                    files = list(list_repo_files(request.repo_id))
                    matches = [f for f in files if fnmatch.fnmatch(f, request.filename)]
                    if matches:
                        # Prefer Q4_K_M if available, otherwise take first match
                        q4_matches = [f for f in matches if 'Q4_K_M' in f]
                        actual_filename = q4_matches[0] if q4_matches else matches[0]
                        yield f"data: {json.dumps({'status': 'info', 'message': f'Found model: {actual_filename}'})}\n\n"
                    else:
                        yield f"data: {json.dumps({'status': 'error', 'message': f'No files matching {request.filename} found in {request.repo_id}'})}\n\n"
                        return
                except Exception as e:
                    yield f"data: {json.dumps({'status': 'error', 'message': f'Failed to list repo files: {str(e)}'})}\n\n"
                    return
            else:
                yield f"data: {json.dumps({'status': 'info', 'message': f'Downloading: {actual_filename}'})}\n\n"

            # Progress tracking variables
            progress_data = {'progress': 0, 'downloaded': 0, 'total': 0, 'message': 'Starting...'}
            download_complete = threading.Event()
            download_error = [None]  # Use list to allow mutation in nested function

            def download_thread():
                try:
                    # This will download or use cache
                    hf_hub_download(
                        repo_id=request.repo_id,
                        filename=actual_filename,
                    )
                except Exception as e:
                    download_error[0] = str(e)
                finally:
                    download_complete.set()

            # Start download in background thread
            thread = threading.Thread(target=download_thread)
            thread.start()

            # Poll for completion (hf_hub_download doesn't expose progress directly)
            dots = 0
            while not download_complete.is_set():
                await asyncio.sleep(1)
                dots = (dots + 1) % 4
                dot_str = '.' * (dots + 1)
                msg = f'Downloading{dot_str} (this may take several minutes for large models)'
                yield f"data: {json.dumps({'status': 'downloading', 'message': msg})}\n\n"

            # Wait for thread to complete
            thread.join()

            if download_error[0]:
                yield f"data: {json.dumps({'status': 'error', 'message': f'Download failed: {download_error[0]}'})}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'complete', 'progress': 100, 'message': f'Model {actual_filename} downloaded successfully! The service will use it on next load.'})}\n\n"

        except ImportError:
            yield f"data: {json.dumps({'status': 'error', 'message': 'huggingface_hub not installed. Run: pip install huggingface_hub'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': f'Error: {str(e)}'})}\n\n"

    return StreamingResponse(
        generate_progress(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    )


@app.get('/download/status')
async def download_status():
    """Check if model is already downloaded/cached"""
    import fnmatch

    try:
        from huggingface_hub import try_to_load_from_cache, list_repo_files

        # Resolve glob pattern to actual filename
        actual_filename = MODEL_FILE
        if '*' in MODEL_FILE or '?' in MODEL_FILE:
            try:
                files = list(list_repo_files(MODEL_REPO))
                matches = [f for f in files if fnmatch.fnmatch(f, MODEL_FILE)]
                if matches:
                    q4_matches = [f for f in matches if 'Q4_K_M' in f]
                    actual_filename = q4_matches[0] if q4_matches else matches[0]
            except Exception:
                pass

        # Check if the model file is in cache
        cached_path = try_to_load_from_cache(MODEL_REPO, actual_filename)

        if cached_path and cached_path is not None and str(cached_path) != 'None':
            return {
                'status': 'cached',
                'path': str(cached_path),
                'filename': actual_filename,
                'message': 'Model is already downloaded'
            }
        else:
            return {
                'status': 'not_downloaded',
                'repo': MODEL_REPO,
                'file': actual_filename,
                'message': 'Model needs to be downloaded'
            }
    except ImportError:
        return {
            'status': 'unknown',
            'message': 'huggingface_hub not installed'
        }
    except Exception as e:
        return {
            'status': 'error',
            'message': str(e)
        }


if __name__ == '__main__':
    uvicorn.run(
        app,
        host='0.0.0.0',
        port=PORT,
        log_level='info'
    )
