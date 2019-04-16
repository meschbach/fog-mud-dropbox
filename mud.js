
class MudContainerCluster {
	constructor(metadataClient) {
		this.metadataClient = metadataClient;
	}

	forContainer( container ){
		return new MudContainerVFS(this.metadataClient, container);
	}
}

const {promiseEvent} = require("junk-bucket/future");
class MudContainerVFS {
	constructor( metadataClient, container ) {
		this.metadataClient = metadataClient;
		this.container = container;
	}

	async createReadableStream( key ){
		return this.metadataClient.stream_from(this.container, key);
	}

	async streamTo( input, toKey ){ //TODO: This could probably be replaced with an adapter which on close will check for an error result
		const httpRequest = this.metadataClient.stream_to(this.container, toKey);
		const responsePromise = promiseEvent(httpRequest, "response");
		const finished = promiseEvent(httpRequest, "close");
		input.pipe(httpRequest);
		await finished;
		const response = await responsePromise;
		if( response.statusCode !== 200 ){
			throw new Error("Failed to store stream: Status code " + response.statusCode);
		}
	}

	//TODO: Without waiting for a response reads are likely to be dispatched before writes.
	async createWritableStream( key ){
		const httpRequest = this.metadataClient.stream_to(this.container, key);
		return httpRequest;
	}
}

module.exports = {
	MudContainerCluster
};
