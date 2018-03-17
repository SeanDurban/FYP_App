const Web3 = require('web3');
const crypto = require('crypto');

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(global.nodeWS)
);
const shh = web3.shh;

let whisper = require('./whisper');
const SESSION_TIMEOUT = 18000; //18 seconds

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
function sendInit(topics, groupContacts, sessionK, name, nodeNo){
    for(var contact of groupContacts) {
        var contactInfo = global.contacts.get(contact);
        if(contactInfo){
            var initMessage = `INIT||${name}||${nodeNo}||${topics}||${sessionK}`;
            whisper.postPublicKey(contactInfo.topic, contactInfo.pubKey, initMessage);
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
//
function sendEnd(topics, sessionK){
    web3.shh.addSymKey(sessionK, (err,id) => {
        for (let topic of topics) {
            let message = 'END';
            whisper.post(topic, id, message);
        }
    })
}

//Handle group controller session timeout rekey
//Sends rekey details to all group members
//Subscribes to new topic, updates group channels map
//Resets the session timeout
function triggerRekey(topic) {
    console.log('Session timedout ', topic);
    let groupName = global.activeTopics.get(topic);
    let groupChannel = global.groupChannels.get(groupName);
    let groupSize = groupChannel.topics.length;
    let nodeNo = 0;
    generateSessionData(groupSize, (newTopics, newSessionK) => {
        sendRekey(groupChannel.topics, groupChannel.sessionK, newSessionK, newTopics);
        let nodeTopic = newTopics[nodeNo];
        whisper.createFilter(newTopics[0], newSessionK, (filterID) => {
            let newSessionData = groupChannel;
            newSessionData.filterID = filterID;
            newSessionData.topics = newTopics;
            newSessionData.sessionK = newSessionK;
            newSessionData.timeout = setTimeout(triggerRekey, SESSION_TIMEOUT, nodeTopic);
            setTimeout(whisper.getFilterMessages, global.messageTimer, filterID, groupName);
            global.activeTopics.set(nodeTopic, groupName);
            global.groupChannels.set(groupName, newSessionData);
            console.log('Rekey - updated groups');
            //Remove the previous session details
            clearPrevSession(topic);
        });
    });
}
//Regularly polls a message filter for new messages
function getNewMessages(groupName) {
    let filterID = global.groupChannels.get(groupName).filterID;
    whisper.getFilterMessages(filterID, groupName);
}
function clearPrevSession(topic){
    //TODO:Set timer when triggered: (Allows other members to handle rekey)
    //TODO: delete message filters
   // global.activeTopics.delete(topic);
}
module.exports = {generateSessionData, getNewKeys, sendInit, sendRekey, sendEnd,triggerRekey,clearPrevSession, getNewMessages};