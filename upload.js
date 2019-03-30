const {Dropbox} = require("dropbox");
const fetch = require("isomorphic-fetch");
const {main} = require("junk-bucket");

const token = process.env["DROPBOX_TOKEN"] || "";

main(async function (logger) {
	if( !token ){
		logger.error("DROPBOX_TOKEN is required");
		return -1;
	}
	const connection = new Dropbox({accessToken: token, fetch });
	await connection.filesUpload({path: "/test", contents: "test"});
	logger.info("Completed");
});
