"""Offline tests for tools/wiki.py. Run: python tests/test_wiki.py"""
import os
import sys
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import wiki


def test_retry_after():
    assert wiki.retry_after("17", 1) == 17
    assert wiki.retry_after("9999", 1) == wiki.MAX_WAIT
    assert wiki.retry_after(None, 3) == 30
    assert wiki.retry_after("soon", 2) == 20


def test_render():
    art = {"title": "Henry I of France", "revid": 123, "url": "https://en.wikipedia.org/wiki/Henry_I_of_France", "text": "Body.\n"}
    out = wiki.render(art, {"born": ["+1008-05-04T00:00:00Z (precision 11)"]})
    assert out.startswith("# Henry I of France\n# revision: 123\n")
    assert "# wikidata born: +1008-05-04" in out
    assert out.endswith("Body.\n")


def test_429_waits_then_succeeds():
    calls, waits = [], []

    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self, *a): return b'{"ok": 1}'

    real = wiki.urllib.request.urlopen

    def fake(req, timeout=0):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(req.full_url, 429, "Too Many", {"Retry-After": "5"}, None)
        return Resp()

    wiki.urllib.request.urlopen = fake
    try:
        assert wiki.get_json("https://example.org/", {"a": 1}, sleep=waits.append) == {"ok": 1}
    finally:
        wiki.urllib.request.urlopen = real
    assert waits == [5] and len(calls) == 2


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ALL TESTS PASSED")
