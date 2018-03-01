var express = require('express');
var router = express.Router();
var Web3 = require('web3');

var web3 = new Web3(
	new Web3.providers.WebsocketProvider('ws://localhost:8546')
);
var sessionStorage = [];
var messageStorage = [];
var shh = web3.shh;
const testTopic = '0xffddaa11';
var appKeyId;
var contacts = new Map();

//web3.shh.addPrivateKey('0x000b5462d1555b674a8b6b8daf24c09e5a8fa4f36251385a2a17d7b1a0d955a4').then(console.log);

router.get('/', function(req, res, next) {
	if(!appKeyId){
		getNewKeys((id) => {
			appKeyId = id;
			subscribeApp();
		});
	}
  res.render('index', {messageStorage, sessionStorage});
});

router.post('/subscribe', (req, res) => {
	var sessionKeyId = generateSymKeyPassword(req.body.inputSessionP, (id) => {
		sessionStorage.push({topic:testTopic, keyId: id});
		subscribe(testTopic, id);
		res.redirect('/');
	});
});

router.post('/postContact', (req, res) => {
	var topic = testTopic; var message = req.body.inputMessage;
		var pK = contacts.get(req.body.inputContact).pubKey;
		postContact(topic, pK, message);
		messageStorage.push('Message sent to topic ( '+ topic + ' ): '+ message);
		res.redirect('/');
});

router.post('/post', (req, res) => {
	var topic = testTopic; var message = req.body.inputMessage;
 	generateSymKeyPassword(req.body.inputSessionP, (id) => {
		post(topic, id, message);
		messageStorage.push('Message sent to topic ( '+ topic + ' ): '+ message);
		res.redirect('/');
	});
});

router.post('/contact', (req, res) => {
	var name = req.body.name;
	var contactInfo = {topic: req.body.topic, pubKey: req.body.publicKey};
	contacts.set(name, contactInfo);
	console.log(contacts);
	//Add to contacts map
	res.redirect('/');
});

function generateSymKeyPassword(password, callback) {
		web3.shh.generateSymKeyFromPassword(password).then(id => {
			callback(id);
		});
}

function subscribe(topic, keyID){
	web3.shh.subscribe('messages', {
				symKeyID: keyID,
				topics: [topic]
			})
			.on('data', res => {
				console.log('message received');
				messageStorage.push('Message from topic ( '+ topic + ' ): '+ web3.utils.hexToAscii(res.payload));
			});
}

function subscribeApp(){
	return new Promise((resolve) => {
		web3.shh.subscribe('messages', {
					privateKeyID: appKeyId,
					topics: [testTopic]
				})
				.on('data', res => {
					console.log('Base message received');
					messageStorage.push('Message from base app'+ web3.utils.hexToAscii(res.payload));
				});
	});
}


function post(topic, keyID, message) {
	web3.shh.post(
			{
				symKeyID: keyID, // encrypts using the sym key ID
				ttl: 20,
				topic: topic,
				payload: web3.utils.asciiToHex(message),
				powTime: 3,
				powTarget: 0.5
			}, (err, res) => {
				if (err) {
					console.log('err post: ', err);
				} else{
					console.log('Sent message');
				}
			}
		);
}

function postContact(topic, pK, message) {
	web3.shh.post(
			{
				pubKey: pK, // encrypts using the sym key ID
				ttl: 20,
				topic: topic,
				payload: web3.utils.asciiToHex(message),
				powTime: 3,
				powTarget: 0.5
			}, (err, res) => {
				if (err) {
					console.log('err post: ', err);
				} else{
					console.log('Sent message');
				}
			}
		);
}

function getNewKeys(callback){
	web3.shh.newKeyPair((err,id) => {
		console.log(id);
		web3.shh.getPublicKey(id, (e2, pk) => {
			console.log(pk);
			web3.shh.getPrivateKey(id, (e3, prk) => {
				console.log(prk);
				callback(id);
			});
		});
	});
}
module.exports = router;
