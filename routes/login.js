var express = require('express');
var router = express.Router();
var web3 = global.web3;

const session = require('../source/session');

router.get('/', (req,res) => {
	res.render('login', {err: req.flash('err'),succ: req.flash('succ')});
});

router.post('/', (req,res) => {
	if(req.body.generateDetails && req.body.generateDetails === 'true'){
		session.generateAppDetails();
	} else {
		session.addAppDetails(req.body.topic, req.body.privateKey)
	}
	res.redirect('/');
});

module.exports = router;