const Web3 = require('web3');
const crypto = require('crypto');

const web3 = new Web3(
    new Web3.providers.WebsocketProvider('ws://localhost:8546')
);
const shh = web3.shh;
const whisper = require('./whisper.js');

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
        var contactInfo = global.contacts.get(contact);
        if(contactInfo){
            var initMessage = `INIT||${name}||${nodeNo}||${topics}||${sessionK}`;
            whisper.postWithPK(contactInfo.topic, contactInfo.pubKey, initMessage)
            nodeNo++;
        }
    }
}
//
function sendRekey(prevTopics, prevK, sessionK, topics){
    web3.shh.addSymKey(prevK, (err, id) => {
        for (let i=1; i<prevTopics.length;i++) { //Skip topic[0] since group controller
            var rekeyMessage = `REKEY||${i}||${topics}||${sessionK}`;
            whisper.post(prevTopics[i], id, rekeyMessage);
        }
    });
}
//Handles parsing of INIT message
//Creates and subscribes to groupChannel
function setupSession(message){
    var groupName = message[1];
    var nodeNo = message[2];
    var topics = message[3].split(',');
    var sessionK = message[4];
    whisper.subscribeWithKey(topics[nodeNo], sessionK);
    var sessionData = {topics:topics, sessionK:sessionK, nodeNo:nodeNo, messages:[], name: groupName, seqNo:0};
    global.groupChannels.set(topics[nodeNo], sessionData);
}
//Handle group member rekey
//Extracts new session details, subscribes to new topic
//Updates group channel map
function handleRekey(topic, payload) {
    let nodeNo = payload[1];
    let newTopics = payload[2].split(',');
    let newSessionK = payload[3];
    let newNodeTopic = newTopics[nodeNo];
    whisper.subscribeWithKey(newNodeTopic, newSessionK);
    let groupChannel = global.groupChannels.get(topic);
    groupChannel.topics = newTopics;  //Only update updated details, keep messages/seqNo
    groupChannel.sessionK = newSessionK;
    groupChannel.nodeNo = nodeNo;
    global.groupChannels.set(newNodeTopic, groupChannel);
    global.messageStorage.push('Rekey for topic ( ' + topic + ' ): ' + payload);
    console.log('Successful Rekey for previous topic ',topic);
    whisper.clearPrevSession(topic);
}
//Handle group controller session timeout rekey
//Sends rekey details to all group members
//Subscribes to new topic, updates group channels map
//Resets the session timeout
function triggerRekey(topic) {
    console.log('Session timedout ', topic);
    let groupChannel = global.groupChannels.get(topic);
    let groupSize = groupChannel.topics.length;
    let nodeNo = 0;
    generateSessionData(groupSize, (newTopics, newSessionK) => {
        sendRekey(groupChannel.topics, groupChannel.sessionK, newSessionK, newTopics);
        let newSessionData = groupChannel;
        newSessionData.topics = newTopics;
        newSessionData.sessionK = newSessionK;
        let nodeTopic = newTopics[nodeNo];
        whisper.subscribeWithKey(nodeTopic, newSessionK);
        global.groupChannels.set(nodeTopic, newSessionData);
        console.log('Rekey - updated groups');
        setTimeout(triggerRekey, SESSION_TIMEOUT, nodeTopic); //10 seconds
        //Remove the previous session details
        whisper.clearPrevSession(topic);
    });
}

function clearPrevSession(topic){
    //TODO: Unsubscribe to topic
    //TODO: Remove topic from groupchannel map
}
module.exports = {generateSessionData, getNewKeys, sendInit, sendRekey, setupSession, handleRekey,triggerRekey,clearPrevSession};