const crypto = require('crypto');
var web3 = global.web3;

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

module.exports = {generateSessionData}

