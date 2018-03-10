var express = require('express');
var router = express.Router();
var Web3 = require('web3');
var web3 = new Web3(
	new Web3.providers.WebsocketProvider('ws://localhost:8546')
);

var shh = web3.shh;
var groupChannels = new Map();

router.get('/:topic', function(req, res, next) {
	groupChannels = global.groupChannels;
	let contacts = global.contacts;
	let nodeTopic= req.params.topic;
	let groupChannel = groupChannels.get(nodeTopic);
	let groupMembers = groupChannel.groupContacts? groupChannel.groupContacts : [];
  	res.render('session',{name: groupChannel.name, topic: nodeTopic, messages:groupChannel.messages.reverse(), groupMembers, contacts});
});

router.post('/:topic', (req, res) => {
	var inputMessage = req.body.inputMessage;
    let nodeTopic= req.params.topic;
    let groupChannel = global.groupChannels.get(nodeTopic);
    let sessionK = groupChannel.sessionK;
    web3.shh.addSymKey(sessionK, (err, id) => {
    	for(let topic of groupChannel.topics) {
    		let message = groupChannel.seqNo + '||' + inputMessage;
            post(topic, id, message);
        }
        groupChannel.seqNo++;
        //This could be possible race condition site
        global.groupChannels.set(nodeTopic,groupChannel);
		res.redirect('/session/'+nodeTopic);
	});

});

router.post('/addMember/:topic', (req, res) => {
    let topic= req.params.topic;
	console.log('Add Member ',topic);
    res.redirect('/session/'+topic);
});

router.post('/removeMember/:topic', (req, res) => {
    let topic= req.params.topic;
    console.log('Remove Member ',topic);
    res.redirect('/session/'+topic);
});

router.get('/exit/:topic', (req, res) => {
    let topic= req.params.topic;
    console.log('Exit group ',topic);
    res.redirect('/session/'+topic);
});

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

module.exports = router;