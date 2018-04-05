const crypto = require('crypto');
var web3 = global.web3;

let whisper = require('./whisper');

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
function appSetup(){
    web3.shh.getInfo((err,info) => {
        if(err)
            throw err;
        getNewKeys((id, pubKey) => {
			var contactInfo = {topic: global.topicInit, pubKey:pubKey };
			global.contacts.set('Me', contactInfo);
			global.nodeInfo = {minPow:info.minPow, pubKey:pubKey, topic:global.topicInit, keyID:id};
			whisper.subscribeApp(id, global.topicInit);
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
//Send REKEY message to all memebers
//Message includes new session data (topics and sessionK)
function sendRekey(prevTopics, prevK, sessionK, topics){
    web3.shh.addSymKey(prevK, (err, id) => {
        for (let i=1; i<prevTopics.length;i++) { //Skip topic[0] since group controller
            var rekeyMessage = `REKEY||${i}||${topics}||${sessionK}`;
            whisper.post(prevTopics[i], id, rekeyMessage);
        }
    });
}
//Send END message to members at given topics
//This can be called due to group controller leaving or due to member(s) being removed
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
        let oldFilterID = groupChannel.filterID;
        whisper.createFilter(newTopics[0], newSessionK, (filterID) => {
            let newSessionData = groupChannel;
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
//Regularly polls a message filter for new messages
function getNewMessages(groupName) {
    let filterID = global.groupChannels.get(groupName).filterID;
    whisper.getFilterMessages(filterID, groupName);
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

module.exports = {generateSessionData, getNewKeys, sendInit, sendRekey, sendEnd,triggerRekey, prevSessionTimeout, getNewMessages, appSetup};
