
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

//Dropbox related
const {Dropbox} = require("dropbox");
const fetch = require("isomorphic-fetch");
const {DropboxVFS} = require("./dropbox");

//Mud related
const {MudContainerCluster} = require("./mud");
const {MudHTTPClient} = require("fog-mud-service/client");

// Key Store
const {KeyStore} = require("./keystore");

async function configureContext( context, logger ){
	// Platform integration
	const configuration = new EnvironmentConfig();

	// Setup Dropbox
	const dropbox = new Dropbox({accessToken: await configuration.dropboxToken(), fetch});
	const dropboxVFS = new DropboxVFS(dropbox);

	//Configure key store
	const keyStore = new KeyStore(dropboxVFS);
	if( !await keyStore.isInitialized() ){
		await keyStore.initialize(await configuration.rootSecret());
	} else {
		await keyStore.unseal(await configuration.rootSecret());
	}

	// Connect to the Mud server
	const mudClient = new MudHTTPClient(await configuration.mudURL(), logger.child({io: "mud"}));

	//
	return {
		dropbox: {
			encrypted: {
				vfs: await keyStore.asVFS()
			}
		},
		mud: {
			client: mudClient,
			cluster: new MudContainerCluster(mudClient)
		}
	}
}

module.exports = {
	configureContext
};
