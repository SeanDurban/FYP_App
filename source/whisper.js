const Web3 = require('web3');
const crypto = require('crypto');

const web3 = new Web3(
    new Web3.providers.WebsocketProvider('ws://localhost:8546')
);
const shh = web3.shh;
const session = require('./session.js');

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
                    session.handleRekey(topic, payload);
                } else {
                    let seqNo = payload[0];
                    let message = payload[1];
                    global.messageStorage.push('Message from topic ( ' + res.topic + ' ): ' + message);
                    //update global groupChannels map
                    let groupChannel = groupChannels.get(topic);
                    if (groupChannel) {
                        groupChannel.messages.push(message);
                        groupChannel.seqNo++;
                        global.groupChannels.set(topic, groupChannel);
                        console.log('Updated Group Channels map');
                    }
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
                session.setupSession(m);
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

function postWithPK(topic, pK, message) {
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

module.exports = {subscribeWithKey,subscribeApp,post,postWithPK};