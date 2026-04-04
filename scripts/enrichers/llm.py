"""Thin LLM client for enricher pipeline.

Uses raw HTTP to the OpenRouter API — no SDK dependency.
Lazy-initialized, reads OPENROUTER_API_KEY from env.
"""

import json
import os
import sys
import time

import requests

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

_API_URL = "https://openrouter.ai/api/v1/chat/completions"
_DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview"
_DEFAULT_MAX_TOKENS = 512


def _get_api_key() -> str:
    """Read API key from env. Raises RuntimeError if not set."""
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    return key


def classify(
    system: str,
    prompt: str,
    *,
    model: str = _DEFAULT_MODEL,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    timeout: float = 10.0,
) -> str:
    """Single LLM classification call. Returns raw text response.

    On rate limit (429), retries once after 2s.
    On any other error, raises immediately (callers degrade to unfiltered).
    """
    api_key = _get_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": 0.0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    }

    for attempt in range(2):
        start = time.monotonic()
        try:
            resp = requests.post(
                _API_URL, headers=headers, json=payload, timeout=timeout
            )
            duration_ms = int((time.monotonic() - start) * 1000)

            if resp.status_code == 429 and attempt == 0:
                eprint(f"  [llm] Rate limited, retrying in 2s")
                time.sleep(2)
                continue

            resp.raise_for_status()
            data = resp.json()
            try:
                text = data["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError) as e:
                raise RuntimeError(f"Unexpected API response structure: {e}. Body: {resp.text[:500]}")

            usage = data.get("usage", {})
            input_tokens = usage.get("prompt_tokens", 0)
            output_tokens = usage.get("completion_tokens", 0)
            eprint(
                f"  [llm] {model} {duration_ms}ms "
                f"tokens={input_tokens}+{output_tokens} "
                f"prompt_len={len(prompt)} response_len={len(text)}"
            )
            return text

        except requests.exceptions.Timeout:
            duration_ms = int((time.monotonic() - start) * 1000)
            eprint(f"  [llm] Timeout after {duration_ms}ms")
            raise
        except requests.exceptions.RequestException as e:
            eprint(f"  [llm] Request failed: {e}")
            raise

    raise RuntimeError("LLM call failed after retries")
