var express = require('express');
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var http = require("http");
var flash = require('connect-flash');
var session = require('express-session');
var fileUpload = require('express-fileupload');
var net = require('net');
var Web3 = require('web3');

var app = express();
let wsAddresses = ['8546','8544','8543'];
let args = process.argv.slice(2);
console.log(args);
if(!args){
  throw "You must provide the node no as parameter eg) node app.js 1";
}
if(args[1] && args[1] == 'DEV'){
	wsAddresses = ['8546','8546','8546'];
}
//global vars
global.contacts = new Map();
global.activeTopics = new Map();
global.groupChannels = new Map();
global.messageStorage = [];
global.messageTimers = new Map();
//App details
global.nodeWS = 'ws://localhost:'+wsAddresses[args[0]-1];
global.topicInit = '0xffddaa11';
global.messageTimer = 5000; //5 secs


if(args[0] == '1') {
	global.web3 = new Web3(new Web3.providers.IpcProvider('\\\\.\\pipe\\geth.ipc', net));
} else {
	global.web3 = new Web3(new Web3.providers.WebsocketProvider(global.nodeWS));
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

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
app.use(fileUpload());

const index = require('./routes/index');
const sessionRoute = require('./routes/session');
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
httpServer.listen(4000+(args[0]-1), function() {
  console.log("Server listening on port 400"+(args[0]-1));
});


module.exports = app;
