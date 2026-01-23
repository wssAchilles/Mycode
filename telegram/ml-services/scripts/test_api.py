import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_health():
    print("Testing /health ...")
    try:
        resp = requests.get(f"{BASE_URL}/health")
        print(f"Status: {resp.status_code}")
        print(f"Response: {resp.json()}")
    except Exception as e:
        print(f"Health check failed: {e}")

def test_ann_retrieve():
    print("\nTesting /ann/retrieve (TS Protocol)...")
    payload = {
        "userId": "U13740",
        "historyPostIds": ["N55189", "N42782", "N34694"],
        "topK": 5
    }
    start = time.time()
    try:
        resp = requests.post(f"{BASE_URL}/ann/retrieve", json=payload)
        elapsed = time.time() - start
        print(f"Status: {resp.status_code}")
        print(f"Time: {elapsed:.2f}s")
        if resp.status_code == 200:
            print("Response:")
            print(json.dumps(resp.json(), indent=2))
        else:
            print(f"Error: {resp.text}")
    except Exception as e:
        print(f"ANN check failed: {e}")

def test_phoenix_predict():
    print("\nTesting /phoenix/predict (TS Protocol)...")
    payload = {
        "userId": "U13740",
        "userActionSequence": [
            {"action": "click", "targetPostId": "N55189"},
            {"action": "like", "targetPostId": "N42782"}
        ],
        "candidates": [
            {"postId": "N45794", "authorId": "U123", "inNetwork": True},
            {"postId": "N12345", "authorId": "U456", "inNetwork": False}
        ]
    }
    start = time.time()
    try:
        resp = requests.post(f"{BASE_URL}/phoenix/predict", json=payload)
        elapsed = time.time() - start
        print(f"Status: {resp.status_code}")
        print(f"Time: {elapsed:.2f}s")
        if resp.status_code == 200:
            print("Response:")
            print(json.dumps(resp.json(), indent=2))
        else:
            print(f"Error: {resp.text}")
    except Exception as e:
        print(f"Phoenix check failed: {e}")

def test_vf_check():
    print("\nTesting /vf/check (TS Protocol)...")
    payload = {
        "items": [
            {"postId": "NB_good_news", "userId": "U1"},
            {"postId": "N_nsfw_news", "userId": "U1"},
            {"postId": "N_spam_alert", "userId": "U1"}
        ]
    }
    try:
        resp = requests.post(f"{BASE_URL}/vf/check", json=payload)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print("Response:")
            print(json.dumps(resp.json(), indent=2))
        else:
            print(f"Error: {resp.text}")
    except Exception as e:
        print(f"VF check failed: {e}")

if __name__ == "__main__":
    test_health()
    test_ann_retrieve()
    test_phoenix_predict()
    test_vf_check()
