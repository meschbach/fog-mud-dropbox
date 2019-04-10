
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
				const error = new Error("Dropbox file not found \""+target+"\"");
				error.missingFile = target;
				throw error;
			} else {
				throw e;
			}
		}
	}
}

module.exports = {
	DropboxVFS
};
