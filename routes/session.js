var express = require('express');
var router = express.Router();
var web3 = global.web3;

const whisper = require('../source/whisper.js');
const session = require('../source/session.js');
const utils= require('../source/utils');

router.get('/:name', function(req, res, next) {
	let groupName= req.params.name;
	let groupChannel = global.groupChannels.get(groupName);
	if(!groupChannel){
		req.flash('err', 'This group does not exist');
		return res.redirect('/');
	}
	let contacts = global.contacts;
	let groupMembers = [];
    if(groupChannel.nodeNo === 0) { //Only group controller has this field
        groupMembers = Object.keys(groupChannel.memberInfo);
    }
    let isExpired = (groupChannel.isExpired && groupChannel.isExpired==true)? true : false;
    let isGroupController = groupChannel.nodeNo == 0 ? true : false;
    let groupInfo = {size:groupChannel.topics.length, noMessages:groupChannel.messages.length, minPow:groupChannel.minPow};
  	res.render('session',{name: groupName, messages:groupChannel.messages.slice().reverse(), groupMembers, contacts,
		groupInfo,isExpired, isGroupController,err: req.flash('err'),succ: req.flash('succ') });
});

router.post('/:name', (req, res) => {
	var inputMessage = req.body.inputMessage;
    let groupName= req.params.name;
    let groupChannel = global.groupChannels.get(groupName);
    let sessionK = groupChannel.sessionK;
    web3.shh.addSymKey(sessionK, (err, id) => {
    	for(let topic of groupChannel.topics) {
    		let message = groupChannel.seqNo + '||' + inputMessage;
            whisper.post(topic, id, message, groupChannel.minPow);
        }
        groupChannel.seqNo++;
        global.groupChannels.set(groupName,groupChannel);
		res.redirect('/session/'+groupName);
	});
});

router.post('/:name/file', (req, res) => {
	let file = req.files.file;
	let groupName= req.params.name;
	let groupChannel = global.groupChannels.get(groupName);
	let sessionK = groupChannel.sessionK;
	web3.shh.addSymKey(sessionK, (err, id) => {
		for(let topic of groupChannel.topics) {
			whisper.postFile(topic, id, file, groupChannel.minPow);
		}
		groupChannel.seqNo++;
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
	let oldFilterID = groupChannel.filterID;
	let oldTopic = groupChannel.topics[groupChannel.nodeNo];
	let newGroupSize = groupChannel.topics.length + 1;
	let newNodeNo = groupChannel.topics.length;
	//Clear current timeout
    clearTimeout(groupChannel.timeout);
	utils.generateSessionData(newGroupSize, (newTopics, newSessionK) => {
	    session.sendInit(newTopics, contactsGiven, newSessionK, groupName, newNodeNo, groupChannel.minPow);
	    session.sendRekey(groupChannel.topics, groupChannel.sessionK, newSessionK, newTopics,groupChannel.minPow);
        whisper.createFilter(newTopics[0], newSessionK, groupChannel.minPow, (filterID) => {
            //Update Maps
            let newSessionData = groupChannel;
            for(let i =0 ; i<contactsGiven.length; i++){
                newSessionData.memberInfo[contactsGiven[i]] = newNodeNo+i;
            }
            newSessionData.filterID = filterID;
            newSessionData.topics = newTopics;
            newSessionData.sessionK = newSessionK;
            newSessionData.timeout = setTimeout(session.triggerRekey, global.SESSION_TIMEOUT, newTopics[0]);
            let messageTimer = setTimeout(whisper.getFilterMessages, global.messageTimer, filterID, groupName);
            global.messageTimers.set(filterID, messageTimer);
            global.activeTopics.set(newTopics[0], groupName);
            global.groupChannels.set(groupName, newSessionData);

            //Clear prev session
            session.prevSessionTimeout(oldTopic, oldFilterID);
        });
    });
    res.redirect('/session/'+groupName);
});

router.post('/:name/removeMember', (req, res) => {
	let groupName= req.params.name;
	let groupChannel = global.groupChannels.get(groupName);
    let memberSelect = req.body.memberSelect;
    memberSelect= (memberSelect.constructor == Array)? memberSelect:[memberSelect];
    console.log('Remove Member ',memberSelect);
   	session.handleRemoveMember(groupName, memberSelect);
	//Send END message to removed member
   	let removedNo = groupChannel.memberInfo[memberSelect[0]];
	let removedTopic = groupChannel.topics[removedNo];
	session.sendEnd([removedTopic], groupChannel.sessionK, groupChannel.minPow);
	res.redirect('/session/'+groupName);
});

router.get('/:name/exit', (req, res) => {
	let groupName= req.params.name;
	let groupChannel = global.groupChannels.get(groupName);
	let nodeTopic = groupChannel.topics[groupChannel.nodeNo];
	session.sendExit(groupChannel.topics[0], groupChannel.nodeNo, groupChannel.sessionK, groupChannel.minPow);
	whisper.handleEnd(nodeTopic);
	req.flash('Successfully Exited Session');
	res.redirect('/session/'+groupName);
});

router.get('/:name/end', (req, res) => {
	let groupName= req.params.name;
	let groupChannel = global.groupChannels.get(groupName);
	let nodeTopic = groupChannel.topics[0];
	//Remove group controller topic
	let topics = groupChannel.topics.filter((topic)=> { return topic!=nodeTopic });
	//Send END messages to all topics (excluding nodeTopic)
	session.sendEnd(topics, groupChannel.sessionK, groupChannel.minPow);
	//Handle End on Group Controller App
	whisper.handleEnd(nodeTopic);
	req.flash('Successfully Ended Session');
	res.redirect('/session/'+groupName);
});

module.exports = router;
