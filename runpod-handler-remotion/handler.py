import runpod
import subprocess
import json
import os
import tempfile

def handler(job):
    job_input = job["input"]
    job_id = job_input.get("jobId", job["id"])

    print(f"[Animator Handler] Starting render for job {job_id}")

    input_path = os.path.join(tempfile.gettempdir(), f"input-{job_id}.json")
    output_path = os.path.join(tempfile.gettempdir(), f"output-{job_id}.json")

    with open(input_path, "w") as f:
        json.dump(job_input, f)

    try:
        result = subprocess.run(
            ["node", "render.js", input_path, output_path],
            capture_output=True,
            text=True,
            timeout=3600,
            cwd="/app",
        )

        print(f"[Animator Handler] Node stdout:\n{result.stdout[-2000:]}")
        if result.stderr:
            print(f"[Animator Handler] Node stderr:\n{result.stderr[-2000:]}")

        if result.returncode != 0:
            error_msg = result.stderr[-500:] if result.stderr else "Unknown error"
            return {"error": f"Render failed (exit {result.returncode}): {error_msg}"}

        if not os.path.exists(output_path):
            return {"error": "Render script did not produce output"}

        with open(output_path, "r") as f:
            output = json.load(f)

        return output

    except subprocess.TimeoutExpired:
        return {"error": "Render timed out after 3600s"}
    except Exception as e:
        return {"error": str(e)}
    finally:
        for p in [input_path, output_path]:
            try:
                os.remove(p)
            except OSError:
                pass


runpod.serverless.start({"handler": handler})
