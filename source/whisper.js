const Web3 = require('web3');
const crypto = require('crypto');

const web3 = new Web3(
    new Web3.providers.WebsocketProvider('ws://localhost:8546')
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
                if(payload[0] == 'REKEY'){
                    handleRekey(topic, payload);
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
                console.log('Sent message');
            }
        }
    );
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
                console.log('err post: ', err);
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
    subscribeWithKey(sessionTopic, sessionK);
    let sessionData = {topics:topics, sessionK:sessionK, nodeNo:nodeNo, messages:[], name: groupName, seqNo:0};
    global.groupChannels.set(groupName, sessionData);
    global.activeTopics.set(sessionTopic, groupName);
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
    subscribeWithKey(newNodeTopic, newSessionK);
    let groupName = global.activeTopics.get(topic);
    let groupChannel = global.groupChannels.get(groupName);
    groupChannel.topics = newTopics;  //Only update updated details, keep messages/seqNo
    groupChannel.sessionK = newSessionK;
    groupChannel.nodeNo = nodeNo;
    global.groupChannels.set(groupName, groupChannel);
    global.activeTopics.set(newNodeTopic, groupName);
    global.messageStorage.push('Rekey for topic ( ' + topic + ' ): ' + payload);
    console.log('Successful Rekey for previous topic ',topic);
    clearPrevSession(topic);
}

function clearPrevSession(topic){
    //TODO: Unsubscribe to topic
    //TODO: Remove topic from groupchannel map
}
module.exports = {subscribeWithKey,subscribeApp,post,postPublicKey};