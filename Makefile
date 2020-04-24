start-server:
	./node_modules/supervisor/lib/cli-wrapper.js --no-restart-on-err -i public server.js

start-redis:
	redis-stable/src/redis-server redis.conf 

.PHONY: start install start-server start-redis commander

install:
	npm install
	wget http://download.redis.io/redis-stable.tar.gz
	tar xvzf redis-stable.tar.gz
	(cd redis-stable; make)

start-commander:
	redis-commander --redis-port 6399

send:
	rsync -Pavz . matrix:~/audio-gui/ --exclude log --exclude node_modules

