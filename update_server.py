import sys

content = open('server_backup.js').read()

old_func = """async function renderSceneWithEffect(imagePath, outputPath, duration, width, height, framerate, sceneIndex, jobId, effectType = 'zoom', renderMethod = 'standard') {
  return new Promise((resolve, reject) => {"""

new_func = """async function renderSceneWithEffect(imagePath, outputPath, duration, width, height, framerate, sceneIndex, jobId, effectType = 'zoom', renderMethod = 'standard') {
  return new Promise(async (resolve, reject) => {"""

if old_func in content:
    content = content.replace(old_func, new_func)
    with open('server_new.js', 'w') as f:
        f.write(content)
    print("SUCCESS")
else:
    print("NOT FOUND")
