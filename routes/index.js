var express = require('express');
var router = express.Router();
var Web3 = require('web3');
var crypto = require('crypto');

var web3 = new Web3(
	new Web3.providers.WebsocketProvider('ws://localhost:8546')
);

let messageStorage = [];
var shh = web3.shh;
const testTopic = '0xffddaa11';
var appKeyId;
var contacts = new Map();
var groupChannels = new Map();
var groupChannelName= '';

router.get('/', function(req, res, next) {
	if(!appKeyId){
		getNewKeys((id,pk) => {
			appKeyId = id;
			var contactInfo = {topic: testTopic, pubKey:pk };
			contacts.set('Me', contactInfo);
			subscribeApp();
		});
	}
	console.log(groupChannels);
  	res.render('index', {messageStorage:messageStorage.reverse(), groupChannels, contacts});
});

router.post('/contact', (req, res) => {
    var name = req.body.name;
    var contactInfo = {topic: testTopic, pubKey: req.body.publicKey};
    contacts.set(name, contactInfo);
	console.log('Added contact ',name);
    res.redirect('/');
});

router.post('/createGroup', (req,res) => {
	//This will be changed to input as multiselect
	var contactsGiven = req.body.contactSelect;
	if(contactsGiven) {
		contactsGiven= (contactsGiven.constructor == Array)? contactsGiven:[contactsGiven];
        var name = req.body.groupName;
        var nodeNo = 0;  //Group controller nodeNo always 0
        generateSessionData(contactsGiven.length + 1, (topics, sessionK) => {
            sendInit(topics, contactsGiven, sessionK, name);
            var sessionData = {topics: topics, sessionK: sessionK, nodeNo: nodeNo, messages: [], name: name, seqNo: 0};
            subscribeWithKey(topics[nodeNo], sessionK);
            groupChannels.set(topics[nodeNo], sessionData);
            global.groupChannels = groupChannels;
            console.log('Created new Group', name);
            res.redirect('/');
        });
    }
});

router.post('/post', (req, res) => {
	var topic = req.body.inputTopic;
	var message = req.body.inputMessage;
	var sessionK = req.body.inputSessionK;
 	web3.shh.addSymKey(sessionK, (err, id) => {
		post(topic, id, message);
		messageStorage.push('Message sent to topic ( '+ topic + ' ): '+ message);
		res.redirect('/');
	});
});
//This subscribes to a topic with a symmetric key provided
//This method is used in the group sessions/channels
function subscribeWithKey(topic, key){
	web3.shh.addSymKey(key,(err,keyID) => {
		web3.shh.subscribe('messages', {
					symKeyID: keyID,
					topics: [topic]
				})
				.on('data', res => {
					console.log('New message received');
					let payload = web3.utils.hexToAscii(res.payload).split('||');
					let seqNo = payload[0];
					let message = payload[1];
					messageStorage.push('Message from topic ( '+ res.topic + ' ): '+message);
					//update global groupChannels map
					let groupChannel = groupChannels.get(topic);
					if(groupChannel){
						groupChannel.messages.push(message);
						groupChannel.seqNo++;
						groupChannels.set(topic, groupChannel);
						console.log('Updated Group Channels map');
                        global.groupChannels = groupChannels;
                    }
				});
		console.log('Subscribed to topic: ', topic);
    });
}
//Subscribes to a set topic (Tinit) with a corresponding key pair
//This public key should be advertised in public domain. This is initial contact point for users
//Used to initialise a group session/channel
function subscribeApp(){
	return new Promise((resolve) => {
		web3.shh.subscribe('messages', {
					privateKeyID: appKeyId,
					topics: [testTopic] //Test topic is Tinit
				})
				.on('data', res => {
					console.log('Base message received');
					var m =  web3.utils.hexToAscii(res.payload).split('||');
					messageStorage.push('Message from base app '+m);
					if(m[0] == 'INIT') //If message is INIT = initialise group
						setupSession(m);
				});
	});
	console.log('App subscribed to: ', testTopic);
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

function postWithPK(topic, pK, message) {
	web3.shh.post(
			{
				pubKey: pK, // encrypts using the public key
				ttl: 20,
				topic: topic,
				payload: web3.utils.asciiToHex(message),
				powTime: 3,
				powTarget: 0.5
			}, (err, res) => {
				if (err) {
					console.log('err post: ', err);
				} else{
					console.log('Sent message ', topic);
				}
			}
		);
}

//Returns noMembers Topics and a SessionKey
function generateSessionData(noMembers, callback) {
	web3.shh.newSymKey((err,id) => {
		web3.shh.getSymKey(id,(err2, key) => {
			let topics = [];
			for(let i=0; i<noMembers; i++){
				topics[i] = '0x' + crypto.randomBytes(4).toString('hex');
			}
			callback(topics, key);
		})
	});
}
//Generate new key pair for app
//In real scenario ideally users could import their own or generate a pair
function getNewKeys(callback){
	web3.shh.newKeyPair((err,id) => {
		web3.shh.getPublicKey(id, (e2, pk) => {
			console.log('PK: ', pk);
			web3.shh.getPrivateKey(id, (e3, prk) => {
				console.log('PRK:', prk);
				callback(id,pk);
			});
		});
	});
}
//Send initialise message to all group members
//Message includes all details required to participate in group channel
function sendInit(topics, groupContacts, sessionK, name){
	let nodeNo = 1;
	for(var contact of groupContacts) {
		var contactInfo = contacts.get(contact);
		if(contactInfo){
			var initMessage = `INIT||${name}||${nodeNo}||${topics}||${sessionK}`;
			postWithPK(contactInfo.topic, contactInfo.pubKey, initMessage)
			nodeNo++;
		}
	}
}
//Handles parsing of INIT message
//Creates and subscribes to groupChannel

function setupSession(message){
	var groupName = message[1];
	var nodeNo = message[2];
	var topics = message[3].split(',');
	var sessionK = message[4];
	subscribeWithKey(topics[nodeNo], sessionK);
	var sessionData = {topics:topics, sessionK:sessionK, nodeNo:nodeNo, messages:[], name: groupName, seqNo:0};
	groupChannels.set(topics[nodeNo], sessionData);
	global.groupChannels = groupChannels;
}

module.exports = router;
