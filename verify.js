
const { main } = require("junk-bucket");
const {Context} = require("junk-bucket/context");
const {formattedConsoleLog} = require("junk-bucket/logging-bunyan");

const {configureContext} = require("./config");

const crypto = require("crypto");
const {MemoryWritable} = require("./junk");
const {promisePiped} = require("junk-bucket/streams");
async function hmacDigest( stream, iv ) {
	const hmacAlgorithm = "sha256";

	const output = new MemoryWritable();
	const hashStream = crypto.createHmac(hmacAlgorithm, iv);
	await promisePiped(stream.pipe(hashStream), output);
	return output.bytes;
}

async function digestStream( stream ){
	const hmacAlgorithm = "sha256";

	const output = new MemoryWritable();
	const hashStream = crypto.createHash(hmacAlgorithm);
	await promisePiped(stream.pipe(hashStream), output);
	return output.bytes;
}

main( async function (logger) {
	const rootContext = new Context("fog-mud-dropbox", logger);

	//Extract configuration context
	const {dropbox, mud} = await configureContext( rootContext, rootContext.logger);

	//Figure out which files we should have
	const initialBackupResponse = await mud.client.initiateObjectBackup();
	const changeSet = initialBackupResponse.changes;
	const result = {
		valid: [],
		missing: [],
		invalid: []
	};
	console.log("Change set", changeSet);
	for( const object of changeSet.created ){
		// Generate value for Mud object
		const mudInputStream = await mud.cluster.forContainer(object.container).createReadableStream(object.key);
		const mudHash = await digestStream(mudInputStream);

		// Generate value for Dropbox client
		const vfsName = object.container + "/" + object.key; //TODO: This needs to be moved into a unit which understands the mapping
		if( !(await dropbox.encrypted.vfs.exists(vfsName)) ){
			result.missing.push(object);
		}else {
			const dropboxInputStream = await dropbox.encrypted.vfs.createReadableStream(vfsName);
			const dropboxHash = await digestStream(dropboxInputStream);
			if( mudHash.equals(dropboxHash) ){
				result.valid.push(object);
			} else {
				result.invalid.push(object);
			}
		}
	}

	console.log("Result: ", result);
}, formattedConsoleLog("fog-mud-dropbox:verify"));