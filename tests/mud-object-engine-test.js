const {expect} = require("chai");
const {performBackupIteration} = require("../mud-object-engine");
const {InMemoryVFS} = require("../junk");

class FakeMudVFS {
	constructor() {
		this.vfs = {};
	}

	forContainer( container ){
		if( !this.vfs[container] ){
			this.vfs[container] = new InMemoryVFS();
		}
		return this.vfs[container];
	}
}

describe("MudObjectEngine", function () {
	describe("Given an initially empty Mud setup", function () {
		describe("When it attempts to backup", function () {
			it("does nothing", async function () {
				await performBackupIteration({modified:[], created:[], destroyed:[]});
			});
		});
	});

	describe("Given a new file", function () {
		describe("When it attempts to backup", function () {
			it("backups the new file file", async function () {
				const inMemoryVFS = new InMemoryVFS();
				const fakeMud = new FakeMudVFS();
				const container = fakeMud.forContainer("modified-container");
				await container.putBytes("pro", "example");
				const changeSet = {modified:[], created:[{container:"modified-container", key:"pro"}], destroyed:[]};
				await performBackupIteration( changeSet, fakeMud, inMemoryVFS);
				expect(await inMemoryVFS.exists("modified-container/pro")).to.be.true;
			});

			describe("And the file is modified", function(){
				it("backups the modified files", async function(){
					const inMemoryVFS = new InMemoryVFS();
					const fakeMud = new FakeMudVFS();
					const container = fakeMud.forContainer("kakafany");
					await container.putBytes("noise", "serene");
					const changeSet = {created:[], modified:[{container:"kakafany", key:"noise"}], destroyed:[]};
					await performBackupIteration( changeSet, fakeMud, inMemoryVFS);
					expect(await inMemoryVFS.exists("kakafany/noise")).to.be.true;
				})
			});

			describe("And hte file is destroyed", function(){
				it("removes the destroyed file", async function(){
					const container = "dododa", key = "some/example/key";
					const inMemoryVFS = new InMemoryVFS();
					const fakeMud = new FakeMudVFS();
					await inMemoryVFS.putBytes(key, "blruch");
					const changeSet = {created:[], destroyed:[{container, key}], modified:[]};
					await performBackupIteration( changeSet, fakeMud, inMemoryVFS);
					expect(await inMemoryVFS.exists(container + "/" + key)).to.eq(false);
				})
			});
		});
	});
});
