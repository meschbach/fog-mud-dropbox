
const { main } = require("junk-bucket");
const {exists} = require("junk-bucket/fs");
const {Context} = require("junk-bucket/context");
const {formattedConsoleLog} = require("junk-bucket/logging-bunyan");
const {KeyStore} = require("./keystore");

//TODO: Might be too fine grained.
class EnvironmentConfig {
	async dropboxToken(){
		const token = process.env["DROPBOX_TOKEN"];
		if( !token ) { throw new Error("Requires DROPBOX_TOKEN set in the environment"); }
		return token;
	}

	async rootSecret(){
		return await this._fromEnv("ROOT_SECRET");
	}

	async stateFile(){
		return await this._fromEnv("UPDATE_STATE");
	}

	async mudURL() {
		return await this._fromEnv("MUD_URL");
	}

	async _fromEnv( key ) {
		const value = process.env[key];
		if( !value ) { throw new Error("Requires "+key+" set in the environment"); }
		return value;
	}
}

const {MemoryReadable, MemoryWritable} = require("./junk");
class DropboxVFS {
	constructor(dropboxClient) {
		this.dropboxClient = dropboxClient;
	}

	async exists( fileName ){
		try {
			await this.dropboxClient.filesGetMetadata({
				path: "/" + fileName
			});
			return true;
		}catch(e){
			if( e.status === 409 ){
				return false;
			} else {
				throw new Error(e.message);
			}
		}
	}

	async createWritableStream( target ){
		//Sigh: Dropbox will require a dance around uploading
		//TODO: Consider writing or finding a stream adapter: https://dropbox.github.io/dropbox-sdk-js/Dropbox.html#filesUploadSessionStart__anchor
		const buffer = new MemoryWritable();
		buffer.on("finish", () => {
			const contents = buffer.bytes;
			this.dropboxClient.filesUpload({
				path: "/" + target,
				contents: contents,
				mode: "overwrite"
			}).catch((e) => console.error("WARNING: this error doesn't propagate properly -> ", e.error, e.stack )); //TODO: Especially because of this
		});
		return buffer;
	}

	async createReadableStream( target ){
		try {
			const response = await this.dropboxClient.filesDownload({
				path: "/" + target
			});
			const contents = response.fileBinary;
			return new MemoryReadable(contents);
		}catch (e) {
			if( e.status === 409 ){
				throw new Error("Dropbox file not found \""+target+"\"");
			} else {
				throw e;
			}
		}
	}
}

class MudContainerCluster {
	constructor(metadataClient) {
		this.metadataClient = metadataClient;
	}

	forContainer( container ){
		return new MudContainerVFS(this.metadataClient, container);
	}
}

class MudContainerVFS {
	constructor( metadataClient, container ) {
		this.metadataClient = metadataClient;
		this.container = container;
	}

	async createReadableStream( key ){
		return this.metadataClient.stream_from(this.container, key);
	}
}

const {Dropbox} = require("dropbox");
const fetch = require("isomorphic-fetch");
const {MudHTTPClient} = require("fog-mud-service/client");
const {readFile} = require("junk-bucket/fs");
const {performBackupIteration} = require("./mud-object-engine");

main( async function (logger) {
	const rootContext = new Context("fog-mud-dropbox", logger);

	// Platform integration
	const configuration = new EnvironmentConfig();

	// Setup Dropbox
	const dropbox = new Dropbox({accessToken: await configuration.dropboxToken(), fetch});
	const dropboxVFS = new DropboxVFS(dropbox);
	const keyStore = new KeyStore(dropboxVFS);
	if( !await keyStore.isInitialized() ){
		await keyStore.initialize(await configuration.rootSecret());
	} else {
		await keyStore.unseal(await configuration.rootSecret());
	}

	// Connect to the Mud server
	const mudClient = new MudHTTPClient(await configuration.mudURL(), logger.child({io: "mud"}));

	// Load our state file
	const stateFile = await configuration.stateFile();
	if( await exists(stateFile) ){
		throw new Error("Not implemented yet");
	} else {
		// What changes have taken place?
		const changeList = await mudClient.initiateObjectBackup();
		console.log("Change list: ", changeList.changes);
		await performBackupIteration(changeList.changes, new MudContainerCluster(mudClient), await keyStore.asVFS());
	}
}, formattedConsoleLog("fog-mud-dropbox"));