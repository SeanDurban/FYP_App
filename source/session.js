const crypto = require('crypto');
var web3 = global.web3;

let whisper = require('./whisper');
const utils= require('./utils');

//Function to assign nodeInfo using newly generated details
function generateAppDetails(){
    web3.shh.getInfo((err,info) => {
        if(err)
            throw err;
        getNewKeys((id, pubKey) => {
			let nodeTopic = '0x' + crypto.randomBytes(4).toString('hex');
			var contactInfo = {topic: nodeTopic, pubKey:pubKey };
			global.contacts.set('Me', contactInfo);
			global.nodeInfo = {minPow:info.minPow, pubKey:pubKey, topic:nodeTopic, keyID:id};
			whisper.subscribeApp(id, nodeTopic);
        });
    });
}
//Function to assign nodeInfo using private key and topic provided
function addAppDetails(topic, privateKey){
	web3.shh.getInfo((err,info) => {
		if(err)
			throw err;
		web3.shh.addPrivateKey(privateKey, (err2, id) => {
			web3.shh.getPublicKey(id, (err3, pubKey) => {
				var contactInfo = {topic: topic, pubKey:pubKey };
				global.contacts.set('Me', contactInfo);
				global.nodeInfo = {minPow:info.minPow, pubKey:pubKey, topic:topic, keyID:id};
				whisper.subscribeApp(id, topic);
			});
		});
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
function sendInit(topics, groupContacts, sessionK, name, nodeNo, minPow){
    for(var contact of groupContacts) {
        var contactInfo = global.contacts.get(contact);
        if(contactInfo){
            var initMessage = `INIT||${name}||${nodeNo}||${topics}||${sessionK}||${minPow}`;
            whisper.postPublicKey(contactInfo.topic, contactInfo.pubKey, initMessage, contactInfo.minPow);
            nodeNo++;
        }
    }
}
//Send REKEY message to all memebers
//Message includes new session data (topics and sessionK)
function sendRekey(prevTopics, prevK, sessionK, topics, minPow){
    web3.shh.addSymKey(prevK, (err, id) => {
        for (let i=1; i<prevTopics.length;i++) { //Skip topic[0] since group controller
            var rekeyMessage = `REKEY||${i}||${topics}||${sessionK}`;
            whisper.post(prevTopics[i], id, rekeyMessage, minPow);
        }
    });
}
//Send END message to members at given topics
//This can be called due to group controller leaving or due to member(s) being removed
function sendEnd(topics, sessionK, minPow){
    web3.shh.addSymKey(sessionK, (err,id) => {
        for (let topic of topics) {
            let message = 'END';
            whisper.post(topic, id, message, minPow);
        }
    });
}
//Send EXIT message to group controller
//This is when a group member wishes to exit group
function sendExit(groupControllerTopic, nodeNo, sessionK, minPow) {
	web3.shh.addSymKey(sessionK, (err,id) => {
	    let message = `EXIT||${nodeNo}`;
	    whisper.post(groupControllerTopic, id, message, minPow);
	});
}
//Handle group controller session timeout rekey
//Sends rekey details to all group members
//Subscribes to new topic, updates group channels map
//Resets the session timeout
function triggerRekey(topic) {
    let groupName = global.activeTopics.get(topic);
    let groupChannel = global.groupChannels.get(groupName);
    if(groupChannel && !groupChannel.isExpired) {
		console.log('Session timedout ', topic);
		let groupSize = groupChannel.topics.length;
		let nodeNo = 0;
		utils.generateSessionData(groupSize, (newTopics, newSessionK) => {
			sendRekey(groupChannel.topics, groupChannel.sessionK, newSessionK, newTopics, groupChannel.minPow);
			let nodeTopic = newTopics[nodeNo];
			let oldFilterID = groupChannel.filterID;
			whisper.createFilter(newTopics[0], newSessionK, groupChannel.minPow, (filterID) => {
				let newSessionData = groupChannel;
				let messageObj = {message:'A Rekey has occured', timestamp: new Date().toLocaleString()};
				newSessionData.messages.push(messageObj);
				newSessionData.filterID = filterID;
				newSessionData.topics = newTopics;
				newSessionData.sessionK = newSessionK;
				newSessionData.timeout = setTimeout(triggerRekey, global.SESSION_TIMEOUT, nodeTopic);
				let messageTimer = setTimeout(whisper.getFilterMessages, global.messageTimer, filterID, groupName);
				global.messageTimers.set(filterID, messageTimer);
				global.activeTopics.set(nodeTopic, groupName);
				global.groupChannels.set(groupName, newSessionData);
				console.log('Rekey - updated groups');
				//Remove the previous session details
				prevSessionTimeout(topic, oldFilterID);
			});
		});
	}
}
//Handle removal of member from group
function handleRemoveMember(groupName, memberSelect){
	let groupChannel = global.groupChannels.get(groupName);
	let oldFilterID = groupChannel.filterID;
	let oldTopic = groupChannel.topics[groupChannel.nodeNo];
	let newGroupSize = groupChannel.topics.length - 1;
	let removedNo = groupChannel.memberInfo[memberSelect[0]];
	//Remove group member from topics and memberInfo
	groupChannel.topics.splice(removedNo,1);
	delete groupChannel.memberInfo[memberSelect[0]];
	//Clear current timeout
	clearTimeout(groupChannel.timeout);
	utils.generateSessionData(newGroupSize, (newTopics, newSessionK) => {
		sendRekey(groupChannel.topics, groupChannel.sessionK, newSessionK, newTopics, groupChannel.minPow);
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
			newSessionData.timeout = setTimeout(triggerRekey, global.SESSION_TIMEOUT, newTopics[0]);
			let messageTimer = setTimeout(whisper.getFilterMessages, global.messageTimer, filterID, groupName);
			global.messageTimers.set(filterID, messageTimer);
			global.activeTopics.set(newTopics[0], groupName);
			global.groupChannels.set(groupName, newSessionData);

			//Clear prev session
			prevSessionTimeout(oldTopic, oldFilterID);
		});
	} );
}

//Regularly polls a message filter for new messages
function getNewMessages(groupName) {
    let filterID = global.groupChannels.get(groupName).filterID;
    whisper.getFilterMessages(filterID, groupName);
}
//Wait set amount seconds then clear session data
//To ensure all nodes are given reasonable time to REKEY if necessary
function prevSessionTimeout(topic, messageFilterID, messageTimer){
    setTimeout(clearSessionData, global.PREV_SESSION_TIMEOUT, topic, messageFilterID);
}
//Message timer is cleared, message filter for topic is deleted and activeTopics map updated accordingly
function clearSessionData(topic, filterID)  {
    let messageTimer = global.messageTimers.get(filterID);
    if(messageTimer) {
        clearTimeout(messageTimer);
        console.log('Cleared message timer for ', topic);
    }
    web3.shh.deleteMessageFilter(filterID).then(console.log('Deleted filter for topic: ',topic));
    global.activeTopics.delete(topic);
}

module.exports = {getNewKeys, sendInit, sendRekey, sendEnd, sendExit, triggerRekey,
    prevSessionTimeout, handleRemoveMember, getNewMessages, generateAppDetails, addAppDetails};
