var express = require('express');
var router = express.Router();
var Web3 = require('web3');
var web3 = new Web3(
	new Web3.providers.WebsocketProvider('ws://localhost:8546')
);

var shh = web3.shh;

const whisper = require('../source/whisper.js');
const session = require('../source/session.js');

router.get('/:name', function(req, res, next) {
	let contacts = global.contacts;
	let groupName= req.params.name;
	let groupChannel = global.groupChannels.get(groupName);
    let groupMembers = groupChannel.groupContacts? groupChannel.groupContacts : [];
  	res.render('session',{name: groupChannel.name, messages:groupChannel.messages.slice().reverse(), groupMembers, contacts});
});

router.post('/:name', (req, res) => {
	var inputMessage = req.body.inputMessage;
    let groupName= req.params.name;
    let groupChannel = global.groupChannels.get(groupName);
    let sessionK = groupChannel.sessionK;
    web3.shh.addSymKey(sessionK, (err, id) => {
    	for(let topic of groupChannel.topics) {
    		let message = groupChannel.seqNo + '||' + inputMessage;
            whisper.post(topic, id, message);
        }
        groupChannel.seqNo++;
        //This could be possible race condition site
        global.groupChannels.set(groupName,groupChannel);
		res.redirect('/session/'+groupName);
	});

});

router.post('/:name/addMember', (req, res) => {
    let groupName= req.params.name;
	console.log('Add Member ',groupName);
	//TODO: Generate new details
    //TODO: Send INIT to new member
    //TODO: Send UPDATE to existing members
    //TODO: Update maps
    res.redirect('/session/'+groupName);
});

router.post('/:name/removeMember', (req, res) => {
    let groupName= req.params.name;
    console.log('Remove Member ',groupName);
    //TODO: Generate new details
    //TODO: Send END to removed member
    //TODO: Send UPDATE to existing members - may need to change nodeNo
    //TODO: Update maps
    res.redirect('/session/'+groupName);
});

router.get('/:name/exit', (req, res) => {
    let groupName= req.params.name;
    console.log('Exit group ',topic);
    //This is on member side
    //TODO: Send EXIT to group controller
    //TODO: Unsubscribe to topic, remove as activeTopic
    res.redirect('/session/'+topic);
});

module.exports = router;