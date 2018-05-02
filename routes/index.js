var express = require('express');
var router = express.Router();
var web3 = global.web3;

const whisper = require('../source/whisper');
const session = require('../source/session');
const utils= require('../source/utils');
const isLoggedIn = utils.isLoggedIn;

router.get('/', isLoggedIn, (req, res) => {
  res.render('index', {messageStorage:global.messageStorage.slice().reverse(), groupChannels:global.groupChannels,
	  contacts:global.contacts, nodeInfo:global.nodeInfo, err: req.flash('err'),succ: req.flash('succ')});
});

//Handle PoW slider changer
router.post('/pow', isLoggedIn, (req,res) => {
	web3.shh.setMinPoW(parseFloat(req.body.minPow), (err) =>{
		if(err){
			req.flash('err',err);
			return res.redirect('/');
		}
		global.nodeInfo.minPow = req.body.minPow;
		req.flash('succ', 'Succesfully Changed PoW level to: '+req.body.minPow);
		return res.redirect('/');
	});
});

//Handle Add Contact POST
router.post('/contact', isLoggedIn, (req, res) => {
    let name = req.body.name;
    let contactInfo = {topic: req.body.topic, pubKey: req.body.publicKey, minPow:req.body.minPow};
    global.contacts.set(name, contactInfo);
		req.flash('succ', 'Succesfully Added contact '+name);
    res.redirect('/');
});

//Handle Create Group POST
router.post('/createGroup', isLoggedIn, (req,res) => {
	let contactsGiven = req.body.contactSelect;
	contactsGiven = (!contactsGiven)? []:contactsGiven;
	contactsGiven = (contactsGiven.constructor == Array)? contactsGiven:[contactsGiven];
	let name = req.body.groupName;
	let minPow = req.body.minPow;
	utils.generateSessionData(contactsGiven.length + 1, (topics, sessionK) => {
		//Group initiator is controller and always nodeNo 0
		session.sendInit(topics, contactsGiven, sessionK, name, 1, minPow);
		let nodeTopic = topics[0];
		whisper.createFilter(nodeTopic,sessionK, minPow, (filterID) => {
			//Update all relevant maps
			//Must record nodeNo of contacts in group for add/remove
			let memberInfo = {};
			for(let nodeNo =0 ; nodeNo<contactsGiven.length; nodeNo++){
				memberInfo[contactsGiven[nodeNo]] = nodeNo+1;
			}
			let sessionData = {topics: topics, sessionK: sessionK, nodeNo: 0, messages: [],
				memberInfo:memberInfo, filterID:filterID, isExpired:false, minPow:minPow};
			sessionData.timeout = setTimeout(session.triggerRekey, global.SESSION_TIMEOUT, nodeTopic); //12 seconds
			let messageTimer = setTimeout(session.getNewMessages, global.messageTimer, name);
			global.messageTimers.set(filterID, messageTimer);
			global.groupChannels.set(name, sessionData);
			global.activeTopics.set(nodeTopic, name);
			req.flash('succ', 'Succesfully created new group'+name);
			res.redirect('/');
		});
	});
});

//Handle send spam POST
router.post('/spam', (req, res) => {
	let pubKey = req.body.publicKey;
	let topic = req.body.topic;
	sendSpam(topic,pubKey,0);
	res.redirect('/');
});
//Send spam messages with PoW value (0.2) to showcase spam prevention
function sendSpam(topic, pubKey, i){
	whisper.postPublicKey(topic,pubKey,'Spam '+i, 0.2);
	if(i<4) { //Only send 4 messages every 3
		setTimeout(sendSpam, 3000, topic, pubKey, i + 1);
	} else {
		console.log('End Spam');
	}
}

module.exports = router;
