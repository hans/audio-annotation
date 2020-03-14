var fs = require('fs');
var path = require('path');
var _ = require('underscore');
var __ = require('lodash');

var redis = require("redis"),
client = redis.createClient(6399);

var microtime = require('microtime');
var express = require('express');
var compression = require('compression');
var morgan = require('morgan')
var cookieParser = require('cookie-parser')
var session = require('express-session')
var errorhandler = require('errorhandler')

var app = express();
app.use(compression());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(cookieParser());
app.use(session({ secret: fs.readFileSync('session-secret', 'ascii') }));

var passport = require('passport'), GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(__dirname + '/public'));

var config = {
    // sandbox: https://mechanicalturk.sandbox.amazonaws.com
    // real: https://mechanicalturk.amazonaws.com
    url: "https://mechanicalturk.sandbox.amazonaws.com",
    receptor: { port: 8080, host: undefined },
    poller: { frequency_ms: 10000 },
    accessKeyId: fs.readFileSync('access-key', 'ascii'),
    secretAccessKey: fs.readFileSync('secret-key', 'ascii'),
    googleClientId: fs.readFileSync('google-client-id', 'ascii'),
    googleClientSecret: fs.readFileSync('google-client-secret', 'ascii'),
};
//var mturk = require('mturk')(config);

function encrypt(key, s) {
    var c = crypto.createCipher('aes-128-cbc', key)
    var s = c.update(new Buffer(s, 'ascii').toString('base64'), 'base64', 'hex')
    s += c.final('hex')
    return s
}

function decrypt(key, s) {
    var d = crypto.createDecipher('aes-128-cbc', key)
    var r = d.update(s, 'hex', 'base64')
    r += d.final('base64')
    return new Buffer(r, 'base64').toString('ascii')
}

function submissionToken(segment, id) {
    var s = encrypt(segmentKey, segment+id)
    return s.substring(s.length-2, s.length)
}

adminUsers = [{ displayName: 'Andrei Barbu',
                emails: [ { value: 'andrei@0xab.com' } ],
                name: { familyName: 'Barbu', givenName: 'Andrei' },
                id: '103086825977904293517' }]

passport.use(new GoogleStrategy({callbackURL: 'http://localhost:3000/auth/google/callback',
                                 clientID: config.googleClientId,
                                 clientSecret: config.googleClientSecret,
                                 scope: 'email'},
                                function(accessToken, refreshToken, profile, done) {
                                    process.nextTick(function () {
                                        console.log('user')
                                        console.log(profile)
                                        return done(null, profile);});}));

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) { return next(); }
    res.redirect('/login')
}

function isAdmin(req) {
    return _.contains(_.map(adminUsers, function(user) { return user.id; }),
                      req.user.id);
}

// Enable this to get authentication!
// function ensureAdmin(req, res, next) {
//      if (req.isAuthenticated() && isAdmin(req)) { return next(); }
//      res.redirect('/login')
// }
function ensureAdmin(req, res, next) {return next();}

var crypto = require('crypto')
var segmentKey = fs.readFileSync('segment-key', 'ascii')

passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});

app.get('/auth/google', passport.authenticate('google'));

app.get('/auth/google/callback', 
        passport.authenticate('google', { failureRedirect: '/login' }),
        function(req, res) { res.redirect('/admin'); });

app.get('/login', function(req, res) { res.redirect('/auth/google'); });

app.get('/logout', function(req, res){
    req.logout();
    res.redirect('/');
});

app.get('/annotations', ensureAdmin, function(req, res) {  
    if(req.query.movie) {
        client.lrange(req.query.movie+":annotations:v1", 0, -1,
                      function (err, replies) {
                          res.contentType('json');
                          res.send(replies);
                      })
    } else {
        res.send("Add a ?movie= parameter with the movie name.");
    }
});

app.get("/admin", ensureAdmin, function(req,res){res.redirect('/private/admin.html')})
app.get("/private/*", ensureAdmin, function(req,res){res.sendfile(__dirname + req.path)})

app.get("/annotation-list", function(req,res){
    res.contentType('json');
    var segments = fs.readFileSync('segments', 'ascii').split('\n')
    res.send(_.map(segments,
                   function(segment, i) {
                       var id = microtime.nowDouble()
                       var token = encrypt(segmentKey,
                                           JSON.stringify({segment: segment,
                                                           id: id}))
                       client.sadd("all-segments", segment)
                       return {id: id,
                               segment: segment,
                               token: token,
                               stoken: submissionToken(segment, id)}}))})

// Public API

app.post("/annotations-for-annotator", function(req,res){
    res.contentType('json');
    client.smembers(
        "all-segments",
        function (err, segments) {
            client.smembers(
                'user:' + req.body.id,
                function (err, annotated) {
                    res.send({segments: segments, annotated: annotated})                    
                })})})

app.post('/submission', function(req, res) {
    req.body.receivedAt = microtime.nowDouble()
    req.body.stoken = submissionToken(req.body.segment, req.body.id)
    console.log(req.body)
    var s = JSON.stringify(req.body)
    movieName = __.split(req.body.segment, ':')[0];
    client.lpush(movieName+":annotations:v1", JSON.stringify(req.body))
    client.lpush('segment:' + req.body.segment, JSON.stringify(req.body))
    client.sadd("all-segments", req.body.segment)
    client.sadd('user:' + req.body.id, req.body.segment)
    client.sadd("all-ids", req.body.id)
    res.contentType('json')
    res.send({ response: "ok",
               stoken: (req.body.token?req.body.stoken:null) });
})

// TODO This really should sign & verify rather than just encrypt
app.post('/details', function(req, res) {
    res.contentType('json');
    var token;
    try {
        var token = JSON.parse(decrypt(segmentKey, req.body.token))
        if(token != null && token.segment != null && token.id != null) {
            res.send({ response: 'ok',
                       segment: token.segment,
                       id: token.id});
        } else throw 'token'
    }  catch(e) {
        res.send({ response: 'badtoken' });
    }
})

app.listen(process.env.PORT || 3000);

app.use(errorhandler());
