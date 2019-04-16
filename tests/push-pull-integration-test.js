const {expect} = require("chai");

const {promiseEvent, parallel} = require("junk-bucket/future");
const {InMemoryVFS} = require("../junk");
const {KeyStore} = require("../keystore");
const {MudContainerCluster} = require("../mud");
const {MudHTTPClient} = require("fog-mud-service/client");
async function testConfig( mudURL, logger, secret ){
	const testSecret = secret || "test"; // TODO: Make this random and rotating.

	const dropboxVFS = new InMemoryVFS();

	//Configure key store
	const keyStore = new KeyStore(dropboxVFS);
	if( !await keyStore.isInitialized() ){
		await keyStore.initialize(testSecret);
	} else {
		await keyStore.unseal(testSecret);
	}

	// Connect to the Mud server
	const mudClient = new MudHTTPClient( mudURL, logger.child({io: "mud"}));

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
		},
		test: {
			targetVFS: dropboxVFS
		}
	}
}

function reconfigreMud( config, mudURL, logger ){
	// Connect to the Mud server
	const mudClient = new MudHTTPClient( mudURL, logger.child({io: "mud"}));

	const mudConfig = {
		client: mudClient,
		cluster: new MudContainerCluster(mudClient)
	};
	return Object.assign({}, config, {mud:mudConfig});
}

const {performBackupIteration} = require("../mud-object-engine");
async function pushService( config ){
	const changeList = await config.mud.client.initiateObjectBackup();
	await performBackupIteration(changeList.changes, new MudContainerCluster(config.mud.client), config.dropbox.encrypted.vfs);
}

async function pullService( config ){
	const storageVFS = config.dropbox.encrypted.vfs;
	const stateFileName = "state";
	if( !(await storageVFS.exists(stateFileName))){
		throw new Error("Missing state file '"+stateFileName + "'");
	}

	//Deserialize the format
	const buffer = await storageVFS.asBytes(stateFileName);
	const stateString = buffer.toString("utf-8");
	const state = JSON.parse(stateString);

	//How do we operate on this version?
	if( state.version !== 0 ){
		throw new Error("Unable to handle found revision: " + state.revision);
	}

	//Find the current version
	const toTransfer = []; //TODO Preformance: This might be faster as an object versus `includes`
	const keys = Object.keys(state.changes);
	for( const backup of keys ){
		const changes = state.changes[backup];
		for( const created of changes.created ){
			if( !toTransfer.includes(created) ){
				toTransfer.push(created);
			}
		}
	}

	//Perform operations
	console.log("Transferring", toTransfer);
	for( const object of toTransfer ){
		console.log("Transferring object", object);
		const istream = await storageVFS.createReadableStream(object.container + "/" + object.key);
		const containerVFS = config.mud.cluster.forContainer(object.container);
		await containerVFS.streamTo(istream, object.key);
	}
}

const {inPorcessService} = require("fog-mud-service/in-proc");
const {createTestLogger} = require("./test-junk");
describe("Push and Pull Integration Test", function () {
	describe("Given a Mud instance with some history", function() {
		beforeEach(async function () {
			//Configure Mud
			const logger = createTestLogger("push-pull", true);
			this.logger = logger;
			this.harness = await inPorcessService(logger);
			await this.harness.client.store_value("test-container", "some-key", "working-value");
			const url = "http://" + this.harness.metadataAddress.address + ":" + this.harness.metadataAddress.port;
			this.config = await testConfig( url, logger );
		});
		afterEach(async function () {
			this.harness.stop();
		});

		describe("When backed up via a push operation", function(){
			beforeEach(async function pushingCurrentState() {
				await pushService(this.config);
			});

			it("is able to restore to a fresh mud instance", async function () {
				const restoreLogger = this.logger.child({mud:"restore"});
				this.newService = await inPorcessService(restoreLogger);
				try {
					const url = "http://" + this.newService.metadataAddress.address + ":" + this.newService.metadataAddress.port;
					this.restoreConfig = await reconfigreMud(this.config, url, restoreLogger);
					await pullService(this.restoreConfig);
					const value = await this.newService.client.get_value("test-container", "some-key");
					expect(value).to.deep.eq("working-value");
				}finally {
					await this.newService.stop();
				}
			});
		});
	});
});
