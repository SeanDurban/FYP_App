var express = require('express');
var router = express.Router();
var Web3 = require('web3');
var web3 = new Web3(
	new Web3.providers.WebsocketProvider('ws://localhost:8546')
);

var shh = web3.shh;

const whisper = require('../source/whisper.js');
const session = require('../source/session.js');
const SESSION_TIMEOUT = 18000; //18 seconds

router.get('/:name', function(req, res, next) {
	let contacts = global.contacts;
	let groupName= req.params.name;
	let groupChannel = global.groupChannels.get(groupName);
	let groupMembers = [];
    if(groupChannel.nodeNo === 0) { //Only group controller has this field
        groupMembers = Object.keys(groupChannel.memberInfo);
    }
  	res.render('session',{name: groupName, messages:groupChannel.messages.slice().reverse(), groupMembers, contacts});
});

router.post('/:name', (req, res) => {
	var inputMessage = req.body.inputMessage;
    let groupName= req.params.name;
    let groupChannel = global.groupChannels.get(groupName);
    let sessionK = groupChannel.sessionK;
    web3.shh.addSymKey(sessionK, (err, id) => {
    	for(let topic of groupChannel.topics) {
    		let message = groupChannel.seqNo + '||' + inputMessage;
            whisper.post(topic, id, message);
        }
        groupChannel.seqNo++;
        //This could be possible race condition site
        global.groupChannels.set(groupName,groupChannel);
		res.redirect('/session/'+groupName);
	});
});

router.post('/:name/addMember', (req, res) => {
    let groupName= req.params.name;
    let contactsGiven = req.body.contactSelect;
    contactsGiven= (contactsGiven.constructor == Array)? contactsGiven:[contactsGiven];
	console.log('Add Member ', contactsGiven);
    let groupChannel = global.groupChannels.get(groupName);
	let newGroupSize = groupChannel.topics.length + 1;
	let newNodeNo = groupChannel.topics.length;
	//Clear current timeout
    clearTimeout(groupChannel.timeout);
	session.generateSessionData(newGroupSize, (newTopics, newSessionK) => {
	    session.sendInit(newTopics, contactsGiven, newSessionK, groupName, newNodeNo);
	    session.sendRekey(groupChannel.topics, groupChannel.sessionK, newSessionK, newTopics);
        whisper.subscribeWithKey(newTopics[0], newSessionK);

        //Update Maps
        let newSessionData = groupChannel;
        for(let i =0 ; i<contactsGiven.length; i++){
            newSessionData.memberInfo[contactsGiven[i]] = newNodeNo+i;
        }
        newSessionData.topics = newTopics;
        newSessionData.sessionK = newSessionK;
        newSessionData.timeout = setTimeout(session.triggerRekey, SESSION_TIMEOUT, newTopics[0]);
        global.activeTopics.set(newTopics[0], groupName);
        global.groupChannels.set(groupName, newSessionData);

        //Clear prev session
        session.clearPrevSession(groupChannel.topics[0]);
    });
    res.redirect('/session/'+groupName);
});

router.post('/:name/removeMember', (req, res) => {
    let groupName= req.params.name;
    console.log('Remove Member ',groupName);
    //TODO: Generate new details
    //TODO: Send END to removed member
    //TODO: Send UPDATE to existing members - may need to change nodeNo
    //TODO: Update maps
    res.redirect('/session/'+groupName);
});

router.get('/:name/exit', (req, res) => {
    let groupName= req.params.name;
    console.log('Exit group ',topic);
    //This is on member side
    //TODO: Send EXIT to group controller
    //TODO: Unsubscribe to topic, remove as activeTopic
    res.redirect('/session/'+topic);
});

module.exports = router;