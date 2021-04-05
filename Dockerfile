FROM node:14.16.0-buster
# Just for the dependencies.
RUN apt-get update && apt-get install -y chromium
WORKDIR /app
RUN npm install puppeteer@8.0.0 playwright@1.10.0
ADD . /app
# Hmm not good practice but shall be enough for this mere test
ENTRYPOINT ["/bin/bash", "-c", "nohup bash -c 'python3 -m http.server 8000 &' && sleep 0.5 && bash -c \"$*\"", "footest"]
