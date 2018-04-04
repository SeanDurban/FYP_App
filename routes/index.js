var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var web3 = global.web3;

const whisper = require('../source/whisper');
const session = require('../source/session');

var appKeyId;
const INIT_TIMEOUT = 25000;  //25 seconds

router.get('/', function(req, res, next) {
	if(!appKeyId){
		session.getNewKeys((id,pk) => {
			appKeyId = id;
			var contactInfo = {topic: global.topicInit, pubKey:pk };
			global.contacts.set('Me', contactInfo);
			whisper.subscribeApp(id, global.topicInit);
		});
	}
  res.render('index', {messageStorage:global.messageStorage.slice().reverse(), groupChannels:global.groupChannels, contacts:global.contacts,err: req.flash('err'),succ: req.flash('succ')});
});

router.post('/pow', (req,res) => {
	web3.shh.setMinPoW(parseFloat(req.body.pow), (err) =>{
		if(err){
			req.flash('err',err);
			return res.redirect('/');
		}
		req.flash('succ', 'Succesfully Changed PoW level to: '+req.body.pow);
		return res.redirect('/');
	});
});

router.post('/contact', (req, res) => {
    let name = req.body.name;
    let contactInfo = {topic: global.topicInit, pubKey: req.body.publicKey};
    //TODO: Add min PoW to contact info
    global.contacts.set(name, contactInfo);
	console.log('Added contact ',name);
    res.redirect('/');
});

router.post('/createGroup', (req,res) => {
	let contactsGiven = req.body.contactSelect;
	if(contactsGiven) {
		contactsGiven= (contactsGiven.constructor == Array)? contactsGiven:[contactsGiven];
        let name = req.body.groupName;
        session.generateSessionData(contactsGiven.length + 1, (topics, sessionK) => {
            //Group initiator is controller and always nodeNo 0
        	session.sendInit(topics, contactsGiven, sessionK, name, 1);
            let nodeTopic = topics[0];
            whisper.createFilter(nodeTopic,sessionK, (filterID) => {
				//Update all relevant maps
				//Must record positions of contacts in group for add/remove
				let memberInfo = {};
				for(let nodeNo =0 ; nodeNo<contactsGiven.length; nodeNo++){
					memberInfo[contactsGiven[nodeNo]] = nodeNo+1;
				}
				let sessionData = {topics: topics, sessionK: sessionK, nodeNo: 0, messages: [], seqNo: 0,
					memberInfo:memberInfo, filterID:filterID, isExpired:false};
				sessionData.timeout = setTimeout(session.triggerRekey, INIT_TIMEOUT, nodeTopic); //12 seconds
                let messageTimer = setTimeout(session.getNewMessages, global.messageTimer, name);
                global.messageTimers.set(filterID, messageTimer);
				global.groupChannels.set(name, sessionData);
				global.activeTopics.set(nodeTopic, name);
				console.log('Created new Group', name);
				res.redirect('/');
            });
        });
    }
});

router.post('/post', (req, res) => {
	let topic = req.body.inputTopic;
	let message = req.body.inputMessage;
	let sessionK = req.body.inputSessionK;
 	web3.shh.addSymKey(sessionK, (err, id) => {
		whisper.post(topic, id, message);
		global.messageStorage.push('Message sent to topic ( '+ topic + ' ): '+ message);
		res.redirect('/');
	});
});

module.exports = router;
