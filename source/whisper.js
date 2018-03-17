const Web3 = require('web3');
const crypto = require('crypto');
const fs = require('fs');

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
function getFilterMessages(filterId, groupName){
    let groupChannel = global.groupChannels.get(groupName);
    if(!groupChannel.isExpired) {
        web3.shh.getFilterMessages(filterId).then((envelopes) => {
            if (envelopes && envelopes.length > 0) {
                for (let envelope of envelopes) {
                    console.log('New message received');
                    let payload = web3.utils.hexToAscii(envelope.payload).split('||');
                    let topic = envelope.topic;
                    if (payload[0] == 'REKEY') {
                        handleRekey(topic, payload);
                    }
                    else if (payload[0] == 'END') {
                        handleEnd(topic);
                    } else {
                        handleMessage(topic, payload);
                    }
                }
            } else {
                console.log('No new messages for :', groupName);
            }
            setTimeout(getFilterMessages, global.messageTimer, filterId, groupName);
        });
    }
}
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
                console.log('err post: ');
            } else{
                console.log('Sent message');
            }
        }
    );
}
//Test function for sending files in hex format
//Files limited to 10mb by underlying DEVp2p transport
function postFile(topic, keyID, filePath) {
    fs.readFile(filePath, 'utf8', (err,data)=>{
        if(err) {
            console.log('error readFile: ', err);
        }
        let message = web3.utils.toHex(data); //Post assumes payload in hex string with 0x prefix
        message = 'FILE||'+message
        web3.shh.post(
            {
                symKeyID: keyID, // encrypts using the sym key ID
                ttl: 20,
                topic: topic,
                payload: message,
                powTime: 3,
                powTarget: 0.5
            }, (err2, res) => {
                if (err2) {
                    console.log('err postFile: ', err2);
                } else{
                    console.log('Sent File : ', filePath);
                }
            }
        );
    });
}
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
                console.log('err post: ');
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
        setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
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
        console.log('Updated Group Channels map');
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
    createFilter(newNodeTopic, newSessionK, (filterID) => {
        let groupName = global.activeTopics.get(topic);
        let groupChannel = global.groupChannels.get(groupName);
        groupChannel.filterID =filterID;
        groupChannel.topics = newTopics;  //Only update updated details, keep messages/seqNo
        groupChannel.sessionK = newSessionK;
        groupChannel.nodeNo = nodeNo;
        global.groupChannels.set(groupName, groupChannel);
        global.activeTopics.set(newNodeTopic, groupName);
        global.messageStorage.push('Rekey for topic ( ' + topic + ' ): ' + payload);
        console.log('Successful Rekey for previous topic ', topic);
        setTimeout(getFilterMessages, global.messageTimer, filterID, groupName);
        clearPrevSession(topic);
    });
}
//
function handleEnd(topic){
    let groupName = global.activeTopics.get(topic);
    let groupChannel = global.groupChannels.get(groupName);
    global.messageStorage.push('End for topic ('+ topic + ')');
    groupChannel.messages.push('End of session');
    groupChannel.isExpired = true;
    global.groupChannels.set(groupName, groupChannel);
    clearPrevSession(topic);
}
//
function clearPrevSession(topic){
    //TODO: Wait for X seconds
    //TODO: clear message filter
    //TODO: stop message timeout loop
    //TODO: Remove topic from groupchannel map
}
module.exports = {subscribeApp,post, postFile,postPublicKey, createFilter, getFilterMessages};