var express = require('express');
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var index = require('./routes/index');
var sessionRoute = require('./routes/session');

var http = require("http");
var flash = require('connect-flash');
var session = require('express-session');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
//app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
//Session storage
app.use(cookieParser('secret'));
app.use(session({ secret: 'secret',
resave: true,
saveUninitialized: true
}));
app.use(flash());


app.use('/', index);
app.use('/session', sessionRoute);


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

//Create Server and listen on port 3000
var httpServer = http.createServer(app);
httpServer.listen(4000, function() {
  console.log("Server listening on port 4000");
});

//global vars
global.contacts = new Map();
global.activeTopics = new Map();
global.groupChannels = new Map();
global.messageStorage = [];


module.exports = app;
