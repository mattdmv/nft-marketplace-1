const { expect } = require("chai");
const { ethers } = require("hardhat");

const toWei = (num) => ethers.utils.parseEther(num.toString())
const fromWei = (num) => ethers.utils.formatEther(num)

describe("NFTMarketplace", function() {
    let deployer, addr1, addr2, nft, marketplace
    let feePercent = 1
    let URI = "Sample URI"

    beforeEach(async function() {
            // get contract factories 
            const NFT = await ethers.getContractFactory("NFT");
            const Marketplace = await ethers.getContractFactory("Marketplace");

            // get signers
            [deployer, addr1, addr2] = await ethers.getSigners()

            // deploy contracts
            nft = await NFT.deploy()
            marketplace = await Marketplace.deploy(feePercent)
    });

    describe("Deployment", function() {
        it("Should track name and symbol of the nft collection", async function() {
            expect(await nft.name()).to.equal("DApp NFT");
            expect(await nft.symbol()).to.equal("DAPP");
        })
        it("Should track feeAccount and feePercent of the marketplace", async function() {
            expect(await marketplace.feeAccount()).to.equal(deployer.address);
            expect(await marketplace.feePercent()).to.equal(feePercent);
        })
    })

    describe("Minting NFTs", function() {
        it("Should track each minted NFT", async function() {

            // addr1 mints an nft
            await nft.connect(addr1).mint(URI)
            expect(await nft.tokenCount()).to.equal(1);
            expect(await nft.balanceOf(addr1.address)).to.equal(1);
            expect(await nft.tokenURI(1)).to.equal(URI);

            // addr2 mints an nft
            await nft.connect(addr2).mint(URI)
            expect(await nft.tokenCount()).to.equal(2);
            expect(await nft.balanceOf(addr2.address)).to.equal(1);
            expect(await nft.tokenURI(2)).to.equal(URI);
        })
    })

    describe("Making the marketplace items", function() {
        beforeEach(async function () {
            // addr1 mints an nft
            await nft.connect(addr1).mint(URI)
            // addr1 approves marketplace to spend an nft
            await nft.connect(addr1).setApprovalForAll(marketplace.address, true)
        })
        it("Should track newly created item, transfer NFT from seller to marketplace and emit Offered event", async function() {
            // addr1 offers an nft at a price of 1 ether
            await expect(marketplace.connect(addr1).makeItem(nft.address, 1, toWei(1))).to.emit(marketplace, "Offered")
            .withArgs(
                1,
                nft.address,
                1,
                toWei(1),
                addr1.address
            );
            // owner of NFT should now be the marketplace
            expect(await nft.ownerOf(1)).to.equal(marketplace.address);
            // itemCount should now equal 1
            expect(await marketplace.itemCount()).to.equal(1);
            // get Item from items mapping and check fields to ensure they are correct
            const item = await marketplace.items(1)
            expect(item.itemId).to.equal(1)
            expect(item.nft).to.equal(nft.address)
            expect(item.tokenId).to.equal(1)
            expect(item.price).to.equal(toWei(1))
            expect(item.sold).to.equal(false)
        })

        it("Should fail if price is equal to zero", async function() {
            await expect(
                marketplace.connect(addr1).makeItem(nft.address, 1, 0)).to.be.revertedWith("Price must be greater than zero");
        })
    })

    describe("Purchasing marketplace items", function() {
        let price = 2
        let fee = (feePercent/100)*price
        let totalPriceInWei

        beforeEach(async function() {
            // addr1 mints an nft
            await nft.connect(addr1).mint(URI)
            // addr1 approves marketplace to spend an nft
            await nft.connect(addr1).setApprovalForAll(marketplace.address, true)
            // addr1 makes it's nft a marketplace item
            await marketplace.connect(addr1).makeItem(nft.address, 1, toWei(price))
        })
        it("Should update item as sold, pay seller, transfer NFT to buyer, charge fee and emit a Bought event", 
        async function() {
            const sellerInitialEthBal = await addr1.getBalance()
            const feeAccountInitialEthBal = await deployer.getBalance()

            // fetch items total price (item price + market fee)
            totalPriceInWei = await marketplace.getTotalPrice(1)

            // addr2 purchases the item
            await expect(marketplace.connect(addr2).purchaseItem(1, {value: totalPriceInWei}))
            .to.emit(marketplace, "Bought")
            .withArgs(
                1,
                nft.address,
                1,
                toWei(price),
                addr1.address,
                addr2.address
            )

            const sellerFinalEthBal = await addr1.getBalance()
            const feeAccountFinalEthBal = await deployer.getBalance()

            // seller should recieve the price of the NFT that was sold
            expect(+fromWei(sellerFinalEthBal)).to.equal(+price + +fromWei(sellerInitialEthBal))

            // feeAccount should recieve fee
            expect(+fromWei(feeAccountFinalEthBal)).to.equal(+fee + +fromWei(feeAccountInitialEthBal))

            // the buyer should now own the nft
            expect(await nft.ownerOf(1)).to.equal(addr2.address)

            // item should be marked as sold
            exoect(await marketplace.items(1).sold).to.equal(true)
        })
        it("Should fail for invalid item ids, sold items and when not enough ether is paid", async function () {
            // fails for invalid item ids
            await expect(
              marketplace.connect(addr2).purchaseItem(2, {value: totalPriceInWei})
            ).to.be.revertedWith("Item doesn't exist.");
            await expect(
              marketplace.connect(addr2).purchaseItem(0, {value: totalPriceInWei})
            ).to.be.revertedWith("Item doesn't exist.");
            // Fails when not enough ether is paid with the transaction. 
            // In this instance, fails when buyer only sends enough ether to cover the price of the nft
            // not the additional market fee.
            await expect(
              marketplace.connect(addr2).purchaseItem(1, {value: toWei(price)})
            ).to.be.revertedWith("Not enough ether to cover item price and market fee."); 
            // addr2 purchases item 1
            await marketplace.connect(addr2).purchaseItem(1, {value: totalPriceInWei})
            // addr3 tries purchasing item 1 after its been sold 
            const addr3 = addrs[0]
            await expect(
              marketplace.connect(addr3).purchaseItem(1, {value: totalPriceInWei})
            ).to.be.revertedWith("Item already sold.");
        });
    })
})