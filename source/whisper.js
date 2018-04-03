const Web3 = require('web3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const buffer = require('buffer');
const web3 = new Web3(
    new Web3.providers.WebsocketProvider(global.nodeWS)
);
const shh = web3.shh;

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
                if (payload[0] == 'REKEY') {
                    handleRekey(topic, payload);
                }
                else if(payload[0] == 'END'){
                    handleEnd(topic);
                } else {
                    handleMessage(res.topic, payload);
                }
            });
        console.log('Subscribed to topic: ', topic);
    });
}
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
            var m =  web3.utils.hexToAscii(res.payload).split('||');
            global.messageStorage.push('Message from base app '+m);
            if(m[0] == 'INIT') //If message is INIT = initialise group
                setupSession(m);
        });
    console.log('App subscribed to: ', topic);
}
//
function createFilter(topic,key, callback){
    web3.shh.addSymKey(key,(err,keyID) => {
        let filter =web3.shh.newMessageFilter({
            symKeyID: keyID,
            topics: [topic],
            minPow: 0.2,
            allowP2P: true
        }).then((id) => {
           callback(id);
        });
        console.log('Message Filter created for topic: ', topic);
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
                    if (payload[0] == 'REKEY') {
                        handleRekey(topic, payload);
                    }
                    else if (payload[0] == 'END') {
                        handleEnd(topic);
                    }
                    else if(payload[0] == 'FILE'){
                        handleFile(topic, payload);
                    }
                    else {
                        handleMessage(topic, payload);
                    }
                }
            } else {
                console.log('No new messages for :', groupName);
            }
            let messageTimer = setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
            global.messageTimers.set(filterID, messageTimer);
        });
    }
}
//Send message with symmetric key with topic and key ID provided
//Assumes message in ASCII format
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
                console.log('Sent message to ', topic);
            }
        }
    );
}
//Function for sending files in hex format
//Files limited to 10mb by underlying DEVp2p transport
function postFile(topic, keyID, file) {
	let fileData= file.data.toString('hex');
    let message = 'FILE||'+file.name+'||'+fileData;
    message = web3.utils.toHex(message);
	web3.shh.post(
        {
            symKeyID: keyID, // encrypts using the sym key ID
            ttl: 80,
            topic: topic,
            payload: message,
            powTime: 40,
            powTarget: 0.3
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
function postPublicKey(topic, pK, message) {
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
    let nodeNo = message[2];
    let topics = message[3].split(',');
    let sessionK = message[4];
    let sessionTopic = topics[nodeNo];
    createFilter(sessionTopic, sessionK, (filterID) => {
        let sessionData = {topics: topics, sessionK: sessionK, nodeNo: nodeNo, messages: [], name: groupName, seqNo: 0, filterID:filterID, isExpired:false};
        let messageTimer = setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
        global.messageTimers.set(filterID, messageTimer);
        global.groupChannels.set(groupName, sessionData);
        global.activeTopics.set(sessionTopic, groupName);
    });
}
//Handle group member message
//Extracts message and updates group channel map
function handleMessage(topic, payload) {
    let seqNo = payload[0];
    let message = payload[1];
    global.messageStorage.push('Message from topic ( ' + topic + ' ): ' + message);
    //update global groupChannels map
    let groupName = global.activeTopics.get(topic);
    let groupChannel = global.groupChannels.get(groupName);
    if (groupChannel) {
        groupChannel.messages.push(message);
        groupChannel.seqNo++;
        global.groupChannels.set(groupName, groupChannel);
    }
}

//Handle group member rekey
//Extracts new session details, subscribes to new topic
//Updates group channel map
function handleRekey(topic, payload) {
    let nodeNo = payload[1];
    let newTopics = payload[2].split(',');
    let newSessionK = payload[3];
    let newNodeTopic = newTopics[nodeNo];
	let groupName = global.activeTopics.get(topic);
	let groupChannel = global.groupChannels.get(groupName);
    let oldFilterID = groupChannel.filterID;
    createFilter(newNodeTopic, newSessionK, (filterID) => {
        groupChannel.filterID =filterID;
        groupChannel.topics = newTopics;  //Only update updated details, keep messages/seqNo
        groupChannel.sessionK = newSessionK;
        groupChannel.nodeNo = nodeNo;
        global.groupChannels.set(groupName, groupChannel);
        global.activeTopics.set(newNodeTopic, groupName);
        global.messageStorage.push('Rekey for topic ( ' + topic + ' ): ' + payload);
        console.log('Successful Rekey for previous topic ', topic);
        let messageTimer = setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
        global.messageTimers.set(filterID, messageTimer);
        prevSessionTimeout(topic, oldFilterID);
    });
}
//Handle END message received
//Sets the group channel as expired as it should no longer receive new messages for that channel
//Clears the session data
function handleEnd(topic){
    let groupName = global.activeTopics.get(topic);
    let groupChannel = global.groupChannels.get(groupName);
    global.messageStorage.push('End for topic ('+ topic + ')');
    groupChannel.messages.push('End of session');
    groupChannel.isExpired = true;
    global.groupChannels.set(groupName, groupChannel);
    prevSessionTimeout(topic, groupChannel.filterID);
}

function handleFile(topic, payload){
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
		let fileMsg = 'File from topic ( ' + topic + ' ): ' + fileName;
		global.messageStorage.push(fileMsg);
		//update global groupChannels map
		let groupName = global.activeTopics.get(topic);
		let groupChannel = global.groupChannels.get(groupName);
		if (groupChannel) {
			groupChannel.messages.push(fileMsg);
			groupChannel.seqNo++;
			global.groupChannels.set(groupName, groupChannel);
		}
	});
}

//Wait set amount seconds then clear session data
//To ensure all nodes are given reasonable time to REKEY if necessary
function prevSessionTimeout(topic, messageFilterID, messageTimer){
    setTimeout(clearSessionData, 12000, topic, messageFilterID);
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

module.exports = {subscribeApp,post, postFile,postPublicKey, createFilter, getFilterMessages};
