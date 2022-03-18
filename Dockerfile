FROM node:17

# Install dependencies
RUN apt update && apt install -y redis-server python3-pip \
        && rm -rf /var/lib/apt/lists/*
# Install deps for data export
RUN pip3 install rdbtools python-lzf

COPY . /app
RUN cd /app && npm install

# Generate secret keys
RUN tr -dc A-Za-z0-9 </dev/urandom | head -c 13 > /app/session-secret
RUN tr -dc A-Za-z0-9 </dev/urandom | head -c 13 > /app/segment-key
