import runpod
import subprocess
import json
import os
import sys
import tempfile

def handler(job):
    job_input = job["input"]
    job_id = job_input.get("jobId", job["id"])
    duration = job_input.get("durationInFrames", "?")
    fps = job_input.get("fps", 30)

    print(f"[Animator Handler] Starting render for job {job_id} ({duration} frames, ~{round(int(duration) / int(fps) / 60) if str(duration).isdigit() else '?'} min)")

    input_path = os.path.join(tempfile.gettempdir(), f"input-{job_id}.json")
    output_path = os.path.join(tempfile.gettempdir(), f"output-{job_id}.json")

    with open(input_path, "w") as f:
        json.dump(job_input, f)

    try:
        proc = subprocess.Popen(
            ["node", "render.js", input_path, output_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd="/app",
        )

        last_lines = []
        for line in proc.stdout:
            line = line.rstrip()
            print(line, flush=True)
            last_lines.append(line)
            if len(last_lines) > 50:
                last_lines.pop(0)

        returncode = proc.wait(timeout=3600)

        if returncode != 0:
            error_msg = "\n".join(last_lines[-10:]) if last_lines else "Unknown error"
            return {"error": f"Render failed (exit {returncode}): {error_msg}"}

        if not os.path.exists(output_path):
            return {"error": "Render script did not produce output"}

        with open(output_path, "r") as f:
            output = json.load(f)

        return output

    except subprocess.TimeoutExpired:
        proc.kill()
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
