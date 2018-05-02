const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const buffer = require('buffer');
const web3 = global.web3;
const utils= require('./utils');

//Subscribes to a set topic (Tinit) with a corresponding key pair
//This public key should be advertised in public domain. This is initial contact point for users
//Used to initialise a group session/channel
function subscribeApp(keyID, topic){
    web3.shh.subscribe('messages', {
        privateKeyID: keyID,
        topics: [topic] //Test topic is Tinit
    })
        .on('data', res => {
			console.log('Base message received');
			var message = web3.utils.hexToAscii(res.payload).split('||');
			if (message[0] == 'INIT'){ //If message is INIT = initialise group
				setupSession(message);
			} else {
				let timestamp = new Date(envelope.timestamp*1000).toLocaleString(); //Convert unix timestamp to readable string
				let messageObj = {message:message, timestamp:timestamp};
				global.messageStorage.push(messageObj);
			}
        });
    console.log('App subscribed to: ', topic);
}
//
function createFilter(topic, key, minPow, callback){
    web3.shh.addSymKey(key,(err,keyID) => {
        let filter =web3.shh.newMessageFilter({
            symKeyID: keyID,
            topics: [topic],
            minPow: parseFloat(minPow),
            allowP2P: true
        }).then((id) => {
           callback(id);
        });
        console.log('Message Filter created for topic and minPoW: ', topic, ' ',minPow);
    });
}
//Regularly polls a message filter for new messages
//If receives new messages then records them
//Resets timer - This could be configurable in settings
function getFilterMessages(filterID, groupName){
    let groupChannel = global.groupChannels.get(groupName);
    if(!groupChannel.isExpired) {
        web3.shh.getFilterMessages(filterID).then((envelopes) => {
            if (envelopes && envelopes.length > 0) {
                for (let envelope of envelopes) {
                    console.log('New message received for ', envelope.topic);
                    let payload = web3.utils.hexToAscii(envelope.payload).split('||');
                    let topic = envelope.topic;
                    let timestamp = new Date(envelope.timestamp*1000).toLocaleString(); //Convert unix timestamp to readable string
                    if (payload[0] == 'REKEY') {
                        handleRekey(topic, payload, timestamp);
                    }
                    else if (payload[0] == 'END') {
                        handleEnd(topic, timestamp);
                    }
                    else if(payload[0] == 'FILE'){
                        handleFile(topic, payload, timestamp);
                    }
                    else if(payload[0] == 'EXIT'){
                        handleExit(topic, payload, timestamp);
                    }
                    else {
                        handleMessage(topic, payload, timestamp);
                    }
                }
            }
            let messageTimer = setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
            global.messageTimers.set(filterID, messageTimer);
        });
    }
}
//Send message with symmetric key with topic and key ID provided
//Assumes message in ASCII format
function post(topic, keyID, message, powTarget) {
	powTarget = Math.max(parseFloat(powTarget), parseFloat(global.nodeInfo.minPow));
    web3.shh.post(
        {
            symKeyID: keyID, // encrypts using the sym key ID
            ttl: 20,
            topic: topic,
            payload: web3.utils.asciiToHex(message),
            powTime: 12,
            powTarget: parseFloat(powTarget)
        }, (err, res) => {
            if (err) {
                console.log('err post: ', err);
            } else{
                console.log('Sent message to ', topic);
            }
        }
    );
}
//Function for sending files in hex format
//Files limited to 10mb by underlying DEVp2p transport
function postFile(topic, keyID, file, powTarget) {
	let fileData= file.data.toString('hex');
  let message = 'FILE||'+file.name+'||'+fileData;
  message = web3.utils.toHex(message);
	powTarget = Math.max(parseFloat(powTarget), parseFloat(global.nodeInfo.minPow));
	web3.shh.post(
        {
            symKeyID: keyID, // encrypts using the sym key ID
            ttl: 50,
            topic: topic,
            payload: message,
            powTime: 70,
            powTarget: parseFloat(powTarget)
        }, (err2, res) => {
            if (err2) {
                console.log('err postFile: ', err2);
            } else{
                console.log('Sent File : ', file.name);
            }
        }
    );
}
//Send message with asymmetric key and topic
function postPublicKey(topic, pK, message, powTarget) {
	powTarget = Math.max(parseFloat(powTarget), parseFloat(global.nodeInfo.minPow));
    web3.shh.post(
        {
            pubKey: pK, // encrypts using the public key
            ttl: 20,
            topic: topic,
            payload: web3.utils.asciiToHex(message),
            powTime: 1,
            powTarget: parseFloat(powTarget)
        }, (err, res) => {
            if (err) {
                console.log('err postPK: ', err);
            } else{
                console.log('Sent message ', topic);
            }
        }
    );
}
//Handles parsing of INIT message
//Creates and subscribes to groupChannel
function setupSession(message){
    let groupName = message[1];
	let messageObj = {message:'New Group created: '+groupName, timestamp:new Date().toLocaleString()};
	global.messageStorage.push(messageObj);
    let nodeNo = message[2];
    let topics = message[3].split(',');
    let sessionK = message[4];
    let minPow = message[5];
    let sessionTopic = topics[nodeNo];
    createFilter(sessionTopic, sessionK, minPow, (filterID) => {
        let sessionData = {topics: topics, sessionK: sessionK, nodeNo: nodeNo, messages: [], name: groupName,
            filterID:filterID, isExpired:false, minPow:minPow};
        let messageTimer = setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
        global.messageTimers.set(filterID, messageTimer);
        global.groupChannels.set(groupName, sessionData);
        global.activeTopics.set(sessionTopic, groupName);
    });
}
//Handle group member message
//Extracts message and updates group channel map
function handleMessage(topic, payload, timestamp) {
    let message = payload[0];
    //update global groupChannels map
    let groupName = global.activeTopics.get(topic);
    let groupChannel = global.groupChannels.get(groupName);
    if (groupChannel) {
    	let messageObj = {message:message, timestamp:timestamp};
        groupChannel.messages.push(messageObj);
        global.groupChannels.set(groupName, groupChannel);
    }
}

//Handle group member rekey
//Extracts new session details, subscribes to new topic
//Updates group channel map
function handleRekey(topic, payload, timestamp) {
    let nodeNo = payload[1];
    let newTopics = payload[2].split(',');
    let newSessionK = payload[3];
    let newNodeTopic = newTopics[nodeNo];
	let groupName = global.activeTopics.get(topic);
	let groupChannel = global.groupChannels.get(groupName);
    let oldFilterID = groupChannel.filterID;
    createFilter(newNodeTopic, newSessionK, groupChannel.minPow, (filterID) => {
    	let messageObj = {message:'A Rekey has occured', timestamp:timestamp};
    	groupChannel.messages.push(messageObj);
        groupChannel.filterID =filterID;
        groupChannel.topics = newTopics;
        groupChannel.sessionK = newSessionK;
        groupChannel.nodeNo = nodeNo;
        global.groupChannels.set(groupName, groupChannel);
        global.activeTopics.set(newNodeTopic, groupName);
        console.log('Successful Rekey for previous topic ', topic);
        let messageTimer = setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
        global.messageTimers.set(filterID, messageTimer);
        prevSessionTimeout(topic, oldFilterID);
    });
}
//Handle END message received
//Sets the group channel as expired as it should no longer receive new messages for that channel
//Clears the session data
function handleEnd(topic, timestamp){
    let groupName = global.activeTopics.get(topic);
    let groupChannel = global.groupChannels.get(groupName);
	let messageObj = {message:'End of session', timestamp:timestamp};
    groupChannel.messages.push(messageObj);
    groupChannel.isExpired = true;
    global.groupChannels.set(groupName, groupChannel);
    prevSessionTimeout(topic, groupChannel.filterID);
}
//Handle FILE message received
//Files are saved in the data folder
//File name is groupName_fileName
function handleFile(topic, payload, timestamp){
    let fileData = Buffer.from(payload[2], 'hex');
	let groupName = global.activeTopics.get(topic);
	let fileName = groupName+'_'+payload[1];
	let filePath = path.join(__dirname, '../data/');
	filePath = path.join(filePath,fileName);
	fs.writeFile(filePath, fileData, (err) => {
	   if(err) {
		   console.log('Err Handle File err',err);
		   return;
	   }
		let fileMsg = {message: 'File from topic ( ' + topic + ' ): ' + fileName, timestamp:timestamp};
		//update global groupChannels map
		let groupName = global.activeTopics.get(topic);
		let groupChannel = global.groupChannels.get(groupName);
		if (groupChannel) {
			groupChannel.messages.push(fileMsg);
			global.groupChannels.set(groupName, groupChannel);
		}
	});
}
//Handle EXIT message received
//Group controller must remove group member wishing to leave
//Following initiate REKEY
function handleExit(topic, payload, timestamp){
    let nodeNo = parseFloat(payload[1]);
	let groupName = global.activeTopics.get(topic);
	let groupChannel = global.groupChannels.get(groupName);
	let memberInfo = Object.entries(groupChannel.memberInfo).filter((entry) =>{
	    return entry[1] == nodeNo;
    });
	let memberSelect = [memberInfo[0][0]];
	handleRemoveMember(groupName, memberSelect);
	let messageObj = {message:'A member has left the group :'+ memberSelect, timestamp:timestamp};
	groupChannel.messages.push(messageObj);
	global.groupChannels.set(groupName, groupChannel);
}

//Handle removal of member from group
//Initiate REKEY
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
		createFilter(newTopics[0], newSessionK, groupChannel.minPow, (filterID) => {
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
			let messageTimer = setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
			global.messageTimers.set(filterID, messageTimer);
			global.activeTopics.set(newTopics[0], groupName);
			global.groupChannels.set(groupName, newSessionData);

			//Clear prev session
			prevSessionTimeout(oldTopic, oldFilterID);
		});
	} );
}
//Send REKEY message to all memebers
//Message includes new session data (topics and sessionK)
function sendRekey(prevTopics, prevK, sessionK, topics, minPow){
	web3.shh.addSymKey(prevK, (err, id) => {
		for (let i=1; i<prevTopics.length;i++) { //Skip topic[0] since group controller
			var rekeyMessage = `REKEY||${i}||${topics}||${sessionK}`;
			post(prevTopics[i], id, rekeyMessage, minPow);
		}
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
			createFilter(newTopics[0], newSessionK, groupChannel.minPow, (filterID) => {
				let newSessionData = groupChannel;
				newSessionData.filterID = filterID;
				newSessionData.topics = newTopics;
				newSessionData.sessionK = newSessionK;
				newSessionData.timeout = setTimeout(triggerRekey, global.SESSION_TIMEOUT, nodeTopic);
				let messageTimer = setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
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
    }
    web3.shh.deleteMessageFilter(filterID).then(console.log('Deleted filter for topic: ',topic));
    global.activeTopics.delete(topic);
}

module.exports = {subscribeApp,post, postFile,postPublicKey, createFilter, getFilterMessages, handleEnd};
