var express = require('express');
var router = express.Router();
var web3 = global.web3;

const whisper = require('../source/whisper.js');
const session = require('../source/session.js');

router.get('/:name', function(req, res, next) {
	let contacts = global.contacts;
	let groupName= req.params.name;
	let groupChannel = global.groupChannels.get(groupName);
	let groupMembers = [];
    if(groupChannel.nodeNo === 0) { //Only group controller has this field
        groupMembers = Object.keys(groupChannel.memberInfo);
    }
    let isExpired =false;
    if(groupChannel.isExpired){
        isExpired = true;
    }
    let groupInfo = {size:groupChannel.topics.length, noMessages:groupChannel.messages.length, minPow:groupChannel.minPow};
  	res.render('session',{name: groupName, messages:groupChannel.messages.slice().reverse(), groupMembers, contacts,
		groupInfo,isExpired,err: req.flash('err'),succ: req.flash('succ') });
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
	session.generateSessionData(newGroupSize, (newTopics, newSessionK) => {
	    session.sendInit(newTopics, contactsGiven, newSessionK, groupName, newNodeNo);
	    session.sendRekey(groupChannel.topics, groupChannel.sessionK, newSessionK, newTopics);
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
    let memberSelect = req.body.memberSelect;
    memberSelect= (memberSelect.constructor == Array)? memberSelect:[memberSelect];
    console.log('Remove Member ',memberSelect);
    let groupChannel = global.groupChannels.get(groupName);
    let oldFilterID = groupChannel.filterID;
    let oldTopic = groupChannel.topics[groupChannel.nodeNo];
    let newGroupSize = groupChannel.topics.length - 1;
    //TODO: extend this to multiple group members
    let removedNo = groupChannel.memberInfo[memberSelect[0]];
    let removedTopic = groupChannel.topics[removedNo];
    session.sendEnd([removedTopic], groupChannel.sessionK, groupChannel.minPow);
    //Remove group member from topics and memberInfo
    groupChannel.topics.splice(removedNo,1);
    delete groupChannel.memberInfo[memberSelect[0]];
    //Clear current timeout
    clearTimeout(groupChannel.timeout);
    session.generateSessionData(newGroupSize, (newTopics, newSessionK) => {
        session.sendRekey(groupChannel.topics, groupChannel.sessionK, newSessionK, newTopics);
        whisper.createFilter(newTopics[0], newSessionK, groupChannel.minPow, (filterID) => {
            let newSessionData = groupChannel;
            //Update memberInfo (nodeNo may have changed)
            for (let name of Object.keys(groupChannel.memberInfo)) {
                if (groupChannel.memberInfo[name] > removedNo) {
                    groupChannel.memberInfo[name]--;
                }
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
    } );
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
