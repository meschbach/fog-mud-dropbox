
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

module.exports = {
	MudContainerCluster
};
