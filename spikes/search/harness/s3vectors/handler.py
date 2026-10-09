# The S3 Vectors probe's Lambda: runs QueryVectors from inside eu-north-1 and times each call.
# AWS_DATA_PATH points boto3 at the service model the CLI ships, which has queryMode.
import json
import os
import time

import boto3

started = time.perf_counter()
client = boto3.client("s3vectors")
QUERIES = json.load(open(os.path.join(os.path.dirname(__file__), "queries.json")))
BUCKET = os.environ["BUCKET"]
FILTERS = {
    "none": None,
    "notSpamTrash": {"labels": {"$nin": ["Spam", "Trash"]}},
    "travel": {"labels": {"$eq": "Travel"}},
}
init_ms = (time.perf_counter() - started) * 1000
calls = 0


def query(index, vector, filter_name, mode, k=20, metadata=True):
    global calls
    args = {"vectorBucketName": BUCKET, "indexName": index, "queryVector": {"float32": vector}, "topK": k, "returnDistance": True, "returnMetadata": metadata}
    if FILTERS.get(filter_name) is not None:
        args["filter"] = FILTERS[filter_name]
    if mode:
        args["queryMode"] = mode
    at = time.perf_counter()
    out = client.query_vectors(**args)
    ms = (time.perf_counter() - at) * 1000
    calls += 1
    return out["vectors"], ms


def handler(event, context):
    kind = event["kind"]
    index = event.get("index", "mailbox")
    if kind == "recall":
        rows = []
        for i in range(event.get("from", 0), event.get("to", len(QUERIES))):
            found, ms = query(index, QUERIES[i], event["filter"], event.get("mode"), event.get("k", 20))
            found = sorted(found, key=lambda v: v["distance"])
            rows.append({"keys": [v["key"] for v in found], "labels": [v.get("metadata", {}).get("labels") for v in found], "ms": round(ms, 1)})
        return {"rows": rows}
    if kind == "latency":
        first = calls == 0
        timings = []
        for n in range(event.get("n", 1)):
            q = QUERIES[(event.get("offset", 0) + n) % len(QUERIES)]
            _, ms = query(index, q, event["filter"], event.get("mode"), event.get("k", 20), event.get("metadata", True))
            timings.append(round(ms, 1))
        return {"firstInEnvironment": first, "initMs": round(init_ms, 1), "ms": timings}
    if kind == "fresh":
        trials = []
        for t in range(event.get("trials", 10)):
            key = f"probe-{int(time.time() * 1000)}-{t}"
            vector = QUERIES[t]
            at = time.perf_counter()
            client.put_vectors(vectorBucketName=BUCKET, indexName=index, vectors=[{"key": key, "data": {"float32": vector}, "metadata": {"labels": ["Probe"]}}])
            put_ms = (time.perf_counter() - at) * 1000
            polls, seen_ms = 0, None
            while polls < 200:
                polls += 1
                found = client.query_vectors(vectorBucketName=BUCKET, indexName=index, queryVector={"float32": vector}, topK=1, filter={"labels": {"$eq": "Probe"}})["vectors"]
                if found and found[0]["key"] == key:
                    seen_ms = (time.perf_counter() - at) * 1000
                    break
            unfiltered = client.query_vectors(vectorBucketName=BUCKET, indexName=index, queryVector={"float32": vector}, topK=1)["vectors"]
            at = time.perf_counter()
            client.delete_vectors(vectorBucketName=BUCKET, indexName=index, keys=[key])
            del_polls, gone_ms = 0, None
            while del_polls < 200:
                del_polls += 1
                found = client.query_vectors(vectorBucketName=BUCKET, indexName=index, queryVector={"float32": vector}, topK=1, filter={"labels": {"$eq": "Probe"}})["vectors"]
                if not found or found[0]["key"] != key:
                    gone_ms = (time.perf_counter() - at) * 1000
                    break
            get_after = client.get_vectors(vectorBucketName=BUCKET, indexName=index, keys=[key])["vectors"]
            trials.append({"putMs": round(put_ms, 1), "searchableMs": seen_ms and round(seen_ms, 1), "polls": polls, "unfilteredTopIsNew": bool(unfiltered and unfiltered[0]["key"] == key),
                           "goneFromSearchMs": gone_ms and round(gone_ms, 1), "deletePolls": del_polls, "getAfterDelete": len(get_after)})
        return {"trials": trials}
    raise ValueError(kind)
