import assertRevert from './helpers/assertRevert'
import assertBalance from './helpers/assertBalance'
const Registry = artifacts.require("Registry")
const TrueUSD = artifacts.require("TrueUSD")
const BalanceSheet = artifacts.require("BalanceSheet")
const AllowanceSheet = artifacts.require("AllowanceSheet")
const TimeLockedController = artifacts.require("TimeLockedController")
const TrueUSDMock = artifacts.require("TrueUSDMock")
const ForceEther = artifacts.require("ForceEther")
const MultisigOwner = artifacts.require("MultisigOwner")
const BasicTokenMock = artifacts.require("BasicTokenMock")
const GlobalPause = artifacts.require("GlobalPause")


contract('MultisigOwner', function (accounts) {
    const [_, owner1, owner2, owner3 , oneHundred, blackListed, mintKey, pauseKey, approver] = accounts
    
    beforeEach(async function () {
        this.registry = await Registry.new({ from: owner1 })
        this.token = await TrueUSDMock.new(oneHundred, 100*10**18, { from: owner1 })
        await this.token.initialize(100*10**18, { from: owner1 })
        this.globalPause = await GlobalPause.new({ from: owner1 })
        await this.token.setGlobalPause(this.globalPause.address, { from: owner1 })
        this.controller = await TimeLockedController.new({ from: owner1 })
        await this.controller.initialize({ from: owner1 })
        await this.controller.setRegistry(this.registry.address, { from: owner1 })
        await this.token.transferOwnership(this.controller.address, { from: owner1 })
        await this.controller.issueClaimOwnership(this.token.address, { from: owner1 })
        await this.controller.setTrueUSD(this.token.address, { from: owner1 })
        await this.controller.setTusdRegistry(this.registry.address, { from: owner1 })
        this.ClaimableContract =await BalanceSheet.new({from: owner1})
        this.balanceSheet = await this.token.balances()
        this.allowanceSheet = await this.token.allowances()
        await this.registry.setAttribute(oneHundred, "hasPassedKYC/AML", 1, "notes", { from: owner1 })
        await this.registry.setAttribute(approver, "isTUSDMintApprover", 1, "notes", { from: owner1 })
        await this.registry.setAttribute(pauseKey, "isTUSDMintChecker", 1, "notes", { from: owner1 })
        this.multisigOwner = await MultisigOwner.new({ from: owner1 })
        await this.multisigOwner.msInitialize([owner1, owner2, owner3], { from: owner1 })
    })

    describe('Multisig Contract claiming TimeLockController', function () {
        it('Multisig can claimownership to TimeLockController', async function () {
            await this.controller.transferOwnership(this.multisigOwner.address, { from: owner1 })
            const initialOwner = await this.controller.owner()
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner1 })
            const currentOwner = await this.controller.owner()
            assert.equal(initialOwner, currentOwner)
            const pendingOwner = await this.controller.pendingOwner()
            assert.equal(pendingOwner, this.multisigOwner.address)
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner2 })
            const finalOwner = await this.controller.owner()
            assert.equal(finalOwner, this.multisigOwner.address)
   
        })

        it('multisig cannot claim ownership when there is another action in flight', async function () {
            await this.controller.transferOwnership(this.multisigOwner.address, { from: owner1 })
            await this.multisigOwner.msIssueclaimContract(this.registry.address, {from : owner1 })
            await assertRevert(this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner2 }));
        })

        it('Multisig cannot claimownership to when ownership is not transferred', async function () {
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner1 })
            await assertRevert(this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner2 })) 
        })

        it('non owners cannot call onlyOwner functions', async function(){
            await this.controller.transferOwnership(this.multisigOwner.address, { from: owner1 })
            await assertRevert(this.multisigOwner.msIssueclaimContract(this.controller.address, {from : oneHundred }));
        })
    })

    describe('Functions independent of timeLockController', async function(){
        it ('cannot be reinitialized', async function(){
            await assertRevert(this.multisigOwner.msInitialize([owner1, owner2, owner3], {from: owner1}))
        })
        it ('current owners are owners', async function(){
            const owner1Result = await this.multisigOwner.owners(owner1)
            const owner2Result = await this.multisigOwner.owners(owner2)
            const owner3Result = await this.multisigOwner.owners(owner3)
            assert.equal(owner1Result,owner2Result)
            assert.equal(owner1Result,owner3Result)
        })

        it ('Owners can modify owner multisig owners', async function(){
            await this.multisigOwner.msUpdateOwner(owner3, oneHundred, {from : owner1 })
            let newOwnerResult = await this.multisigOwner.owners(oneHundred)
            let owner3Result = await this.multisigOwner.owners(owner3)
            assert.equal(newOwnerResult,false)
            assert.equal(owner3Result,true)
            await this.multisigOwner.msUpdateOwner(owner3, oneHundred, {from : owner2 })
            newOwnerResult = await this.multisigOwner.owners(oneHundred)
            owner3Result = await this.multisigOwner.owners(owner3)
            assert.equal(newOwnerResult,true)
            assert.equal(owner3Result,false)
            const ownerList0 = await this.multisigOwner.ownerList(0)
            const ownerList1 = await this.multisigOwner.ownerList(1)
            const ownerList2 = await this.multisigOwner.ownerList(2)

            assert.equal(ownerList0, owner1)
            assert.equal(ownerList1, owner2)
            assert.equal(ownerList2, oneHundred)
        })

        it ('Owners can set timelock controller', async function(){
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner1 })
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner2 })
            const controller = await this.multisigOwner.timeLockController();
            assert.equal(controller, this.controller.address)
        })


        it ('Owners can transfer contract it owns to other addresses', async function(){
            await this.controller.transferOwnership(this.multisigOwner.address, { from: owner1 })
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner1 })
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner2 })
            const currentOwner = await this.controller.owner()
            assert.equal(currentOwner, this.multisigOwner.address)

            await this.multisigOwner.msReclaimContract(this.controller.address, oneHundred, {from : owner1 })
            await this.multisigOwner.msReclaimContract(this.controller.address, oneHundred, {from : owner2 })
            const controllerPendingOwner = await this.controller.pendingOwner()
            assert.equal(controllerPendingOwner, oneHundred)
        })

        it ('owners can reclaim ether',async function(){
            const emptyAddress = "0x0000000000000000000000000000000000000002"
            await this.multisigOwner.sendTransaction({from: oneHundred, gas: 30000, value: 10*10**18});                  
            const balanceWithEther = web3.fromWei(web3.eth.getBalance(this.multisigOwner.address), 'ether').toNumber()
            assert.equal(balanceWithEther, 10)
            await this.multisigOwner.msReclaimEther(emptyAddress, {from : owner1 })
            await this.multisigOwner.msReclaimEther(emptyAddress, {from : owner2 })
            const multisigFinalBalance = web3.fromWei(web3.eth.getBalance(this.multisigOwner.address), 'ether').toNumber()
            const userBalance = web3.fromWei(web3.eth.getBalance(emptyAddress), 'ether').toNumber()
            assert.equal(multisigFinalBalance, 0)
            assert.equal(userBalance, 10)
        })

        it('owners can reclaim token', async function(){
            this.basicToken = await BasicTokenMock.new(this.multisigOwner.address, 100, {from: owner1});
            await this.multisigOwner.msReclaimToken(this.basicToken.address, oneHundred, {from : owner1 })
            await this.multisigOwner.msReclaimToken(this.basicToken.address, oneHundred,  {from : owner2 })
            const contractBalance = await this.basicToken.balanceOf(this.multisigOwner.address)
            const userBalance = await this.basicToken.balanceOf(oneHundred)
            assert.equal(Number(contractBalance), 0)
            assert.equal(Number(userBalance), 100)
        })

        it('owners can veto actions', async function(){
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner1 })
            await this.multisigOwner.veto({from : owner2 })
            await this.multisigOwner.veto({from : owner3 })
            const ownerAction = await this.multisigOwner.ownerAction();
            assert.equal(ownerAction[0], '0x')
            assert.equal(Number(ownerAction[1]), 0)
            assert.equal(Number(ownerAction[2]), 0)
        })

        it('owners cannot veto when there is no action', async function(){
            await assertRevert(this.multisigOwner.veto({from : owner3 }))
        })


        it('owner cannot veto an action twice', async function(){
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner1 })
            await this.multisigOwner.veto({from : owner2 })
            await assertRevert(this.multisigOwner.veto({from : owner2 }))
        })

        it('same owner cannot sign the same action twice', async function(){
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner1 })
            await assertRevert(this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner1 }))
        })

    }) 

    describe('Call timeLockController functions', function(){
        beforeEach(async function () {
            await this.controller.transferOwnership(this.multisigOwner.address, { from: owner1 })
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner1 })
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner2 })
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner1 })
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner2 })
        })

        it('call reclaimEther of timeLockController', async function(){
            const forceEther = await ForceEther.new({ from: oneHundred, value: "10000000000000000000" })
            await forceEther.destroyAndSend(this.controller.address)
            const controllerInitialBalance = web3.fromWei(web3.eth.getBalance(this.controller.address), 'ether').toNumber()
            const multisigInitialBalance = web3.fromWei(web3.eth.getBalance(this.multisigOwner.address), 'ether').toNumber()
            await this.multisigOwner.reclaimEther(this.multisigOwner.address, {from: owner1})
            await this.multisigOwner.reclaimEther(this.multisigOwner.address, {from: owner2})
            const controllerFinalBalance = web3.fromWei(web3.eth.getBalance(this.controller.address), 'ether').toNumber()
            const multisigFinalBalance = web3.fromWei(web3.eth.getBalance(this.multisigOwner.address), 'ether').toNumber()
            assert.equal(controllerInitialBalance, 10)
            assert.equal(multisigInitialBalance, 0)
            assert.equal(controllerFinalBalance, 0)
            assert.equal(multisigFinalBalance, 10)
        })

        it('call reclaimToken of timeLockController', async function(){
            await this.token.transfer(this.controller.address, 40*10**18, { from: oneHundred })
            await this.multisigOwner.reclaimToken(this.token.address, owner1, { from: owner1 })
            await this.multisigOwner.reclaimToken(this.token.address, owner1, { from: owner2 })
            await assertBalance(this.token, owner1, 40*10**18)
        })

        it('function should fail if controller call fails', async function(){
            await this.multisigOwner.transferOwnership(this.ClaimableContract.address, {from: owner1})
            await assertRevert(this.multisigOwner.transferOwnership(this.ClaimableContract.address, {from: owner1}))
        })

        it('function should fail if controller call fails pt2', async function(){
            await this.multisigOwner.transferChild(this.controller.address, oneHundred, {from: owner1})
            await assertRevert(this.multisigOwner.transferChild(this.controller.address, oneHundred, {from: owner2}))
        })


        it('call transferOwnership of timeLockController', async function(){
            await this.multisigOwner.transferOwnership(oneHundred,{from: owner1})
            await this.multisigOwner.transferOwnership(oneHundred,{from: owner2})
            const pendingOwner = await this.controller.pendingOwner()
            assert.equal(pendingOwner, oneHundred)
        })

        it('call setMintThresholds of timeLockController', async function(){
            await this.multisigOwner.setMintThresholds(10*10**18,100*10**18,1000*10**18, { from: owner1 })
            await this.multisigOwner.setMintThresholds(10*10**18,100*10**18,1000*10**18, { from: owner2 })
        })

        it('call setMintLimits of timeLockController', async function(){
            await this.multisigOwner.setMintLimits(30*10**18,300*10**18,3000*10**18,{ from: owner1 })
            await this.multisigOwner.setMintLimits(30*10**18,300*10**18,3000*10**18,{ from: owner2 })
        })

        it('call refillJumboMintPool of timeLockController', async function(){
            await this.multisigOwner.refillJumboMintPool({ from: owner1 })
            await this.multisigOwner.refillJumboMintPool({ from: owner2 })
        })

        it('call refillRatifiedMintPool of timeLockController', async function(){
            await this.multisigOwner.refillJumboMintPool({ from: owner1 })
            await this.multisigOwner.refillJumboMintPool({ from: owner2 })
            await this.multisigOwner.refillRatifiedMintPool({ from: owner1 })
            await this.multisigOwner.refillRatifiedMintPool({ from: owner2 })
        })

        it('call refillInstantMintPool of timeLockController', async function(){
            await this.multisigOwner.refillJumboMintPool({ from: owner1 })
            await this.multisigOwner.refillJumboMintPool({ from: owner2 })
            await this.multisigOwner.refillRatifiedMintPool({ from: owner1 })
            await this.multisigOwner.refillRatifiedMintPool({ from: owner2 })
            await this.multisigOwner.refillInstantMintPool({ from: owner1 })
            await this.multisigOwner.refillInstantMintPool({ from: owner2 })
        })

        it('call pauseMints of timeLockController', async function(){
            await this.multisigOwner.pauseMints({from: owner1})
            await this.multisigOwner.pauseMints({from: owner2})
            let mintPaused = await this.controller.mintPaused()
            assert.equal(mintPaused,true)
            await this.multisigOwner.unpauseMints({from: owner1})
            await this.multisigOwner.unpauseMints({from: owner2})
            mintPaused = await this.controller.mintPaused()
            assert.equal(mintPaused,false)
        })

        it('call setTrueUSD of timeLockController', async function(){
            await this.multisigOwner.setTrueUSD(this.token.address, {from: owner1})
            await this.multisigOwner.setTrueUSD(this.token.address, {from: owner2})
            const trueUSD = await this.controller.trueUSD()
            assert.equal(trueUSD,this.token.address)
        })

        it('call changeTokenName of timeLockController', async function(){
            await this.multisigOwner.changeTokenName("Terry Token", "ttt", {from: owner1})
            await this.multisigOwner.changeTokenName("Terry Token", "ttt", {from: owner2})
            const name = await this.token.name()
            const symbol = await this.token.symbol()
            assert.equal(name,"Terry Token")
            assert.equal(symbol,"ttt")
        })

        it('call setTusdRegistry of timeLockController', async function(){
            await this.multisigOwner.setTusdRegistry(this.registry.address, {from: owner1})
            await this.multisigOwner.setTusdRegistry(this.registry.address, {from: owner2})
            const registry = await this.token.registry()
            assert.equal(registry,this.registry.address)
        })

        it('call transferChild of timeLockController', async function(){
            await this.multisigOwner.transferChild(this.token.address, oneHundred, {from: owner1})
            await this.multisigOwner.transferChild(this.token.address, oneHundred, {from: owner2})
            const pendingOwner = await this.token.pendingOwner()
            assert.equal(pendingOwner, oneHundred)
        })

        it('call requestReclaimContract of timeLockController', async function(){
            const balances = await this.token.balances()
            let balanceOwner = await BalanceSheet.at(balances).owner()
            assert.equal(balanceOwner, this.token.address)

            await this.multisigOwner.requestReclaimContract(balances, { from: owner1 })
            await this.multisigOwner.requestReclaimContract(balances, { from: owner2 })
            await this.multisigOwner.issueClaimOwnership(balances, { from: owner1 })
            await this.multisigOwner.issueClaimOwnership(balances, { from: owner2 })
            balanceOwner = await BalanceSheet.at(balances).owner()
            assert.equal(balanceOwner, this.controller.address)

        })


        it('call requestReclaimEther of timeLockController', async function(){
            const forceEther = await ForceEther.new({ from: oneHundred, value: "10000000000000000000" })
            await forceEther.destroyAndSend(this.token.address)
            const balance1 = web3.fromWei(web3.eth.getBalance(this.multisigOwner.address), 'ether').toNumber()
            await this.multisigOwner.requestReclaimEther({from: owner1})
            await this.multisigOwner.requestReclaimEther({from: owner2})
            const balance2 = web3.fromWei(web3.eth.getBalance(this.multisigOwner.address), 'ether').toNumber()
            assert.isAbove(balance2, balance1)

        })

        it('call requestReclaimToken of timeLockController', async function(){
            this.basicToken = await BasicTokenMock.new(this.token.address, 100, {from: owner1});

            await this.multisigOwner.requestReclaimToken(this.basicToken.address, {from: owner1})
            await this.multisigOwner.requestReclaimToken(this.basicToken.address, {from: owner2})
            
            const tokenContractBalance = await this.basicToken.balanceOf(this.token.address)
            const multiSigBalance = await this.basicToken.balanceOf(this.multisigOwner.address)
            assert.equal(Number(tokenContractBalance), 0)
            assert.equal(Number(multiSigBalance), 100)

            await this.multisigOwner.msReclaimToken(this.basicToken.address, oneHundred, {from : owner1 })
            await this.multisigOwner.msReclaimToken(this.basicToken.address, oneHundred,  {from : owner2 })
            
            const userBalance = await this.basicToken.balanceOf(oneHundred)
            assert.equal(Number(userBalance), 100)
        })

        it('call setGlobalPause of timeLockController', async function(){
            await this.multisigOwner.setGlobalPause(oneHundred, {from: owner1})
            await this.multisigOwner.setGlobalPause(oneHundred, {from: owner2})
            const GlobalPauseAddress = await this.token.globalPause()
            assert.equal(GlobalPauseAddress, oneHundred)

        })
    
        it('call setTrueUsdFastPause of timeLockController', async function(){
            await this.multisigOwner.setTrueUsdFastPause(oneHundred, {from: owner1})
            await this.multisigOwner.setTrueUsdFastPause(oneHundred, {from: owner2})
            const trueUsdFastPause = await this.controller.trueUsdFastPause()
            assert.equal(trueUsdFastPause, oneHundred)
        })

        it('call pauseTrueUSD and unpauseTrueUSD of timeLockController', async function(){
            await this.multisigOwner.pauseTrueUSD({from: owner1})
            await this.multisigOwner.pauseTrueUSD({from: owner2})
            let paused = await this.token.paused()
            assert.equal(paused, true)
            await this.multisigOwner.unpauseTrueUSD({from: owner1})
            await this.multisigOwner.unpauseTrueUSD({from: owner2})
            paused = await this.token.paused()
            assert.equal(paused, false)
        })

        it('call wipeBlackListedTrueUSD of timeLockController', async function(){
            await this.registry.setAttribute(blackListed, "isBlacklisted", 1, "notes", { from: owner1 })
            await this.multisigOwner.wipeBlackListedTrueUSD(blackListed, {from: owner1})
            await this.multisigOwner.wipeBlackListedTrueUSD(blackListed, {from: owner2})
        })

        it('call setBurnBounds of timeLockController', async function(){
            await this.multisigOwner.setBurnBounds(3*10**18, 4*10**18, {from: owner1})
            await this.multisigOwner.setBurnBounds(3*10**18, 4*10**18, {from: owner2})

            const min = await this.token.burnMin()
            assert.equal(min, 3*10**18)
            const max = await this.token.burnMax()
            assert.equal(max, 4*10**18)

        })

        it('call changeStakingFees of timeLockController', async function(){
            await this.multisigOwner.changeStakingFees(1, 2, 3, 4, 5, 6, 7, 8, {from: owner1})
            await this.multisigOwner.changeStakingFees(1, 2, 3, 4, 5, 6, 7, 8, {from: owner2})
            const transferFeeNumerator = await this.token.transferFeeNumerator()
            assert.equal(transferFeeNumerator, 1)
            const transferFeeDenominator = await this.token.transferFeeDenominator()
            assert.equal(transferFeeDenominator, 2)
            const mintFeeNumerator = await this.token.mintFeeNumerator()
            assert.equal(mintFeeNumerator, 3)
            const mintFeeDenominator = await this.token.mintFeeDenominator()
            assert.equal(mintFeeDenominator, 4)
            const mintFeeFlat = await this.token.mintFeeFlat()
            assert.equal(mintFeeFlat, 5)
            const burnFeeNumerator = await this.token.burnFeeNumerator()
            assert.equal(burnFeeNumerator, 6)
            const burnFeeDenominator = await this.token.burnFeeDenominator()
            assert.equal(burnFeeDenominator, 7)
            const burnFeeFlat = await this.token.burnFeeFlat()
            assert.equal(burnFeeFlat, 8)

        })

        it('call changeStaker of timeLockController', async function(){
            await this.multisigOwner.changeStaker(oneHundred, {from: owner1})
            await this.multisigOwner.changeStaker(oneHundred, {from: owner2})
            const staker = await this.token.staker()
            assert.equal(staker, oneHundred)
        })
    })

    describe('mint related owner actions', function(){
        beforeEach(async function () {
            await this.controller.setMintThresholds(10*10**18,100*10**18,1000*10**18, { from: owner1 })
            await this.controller.setMintLimits(30*10**18,300*10**18,3000*10**18,{ from: owner1 })
            await this.controller.refillJumboMintPool({ from: owner1 })
            await this.controller.refillRatifiedMintPool({ from: owner1 })
            await this.controller.refillInstantMintPool({ from: owner1 })
            await this.controller.transferOwnership(this.multisigOwner.address, { from: owner1 })
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner1 })
            await this.multisigOwner.msIssueclaimContract(this.controller.address, {from : owner2 })
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner1 })
            await this.multisigOwner.msSetTimeLockController(this.controller.address, {from : owner2 })
            await this.multisigOwner.transferMintKey(mintKey, {from : owner2 })
            await this.multisigOwner.transferMintKey(mintKey, {from : owner3 })

        })

        it('owner can instant mint', async function(){
            await this.multisigOwner.instantMint(oneHundred, 10*10**18,  {from: owner1})
            await this.multisigOwner.instantMint(oneHundred, 10*10**18, {from: owner2})
            await assertBalance(this.token, oneHundred, 110*10**18)
        })

        it('owner can pause and unpause mint', async function(){
            await this.multisigOwner.requestMint(oneHundred, 10*10**18, {from: owner1})
            await this.multisigOwner.requestMint(oneHundred, 10*10**18, {from: owner2})
            await this.multisigOwner.pauseMint(0,  {from: owner1})
            await this.multisigOwner.pauseMint(0,  {from: owner2})
            let mintOperation = await this.controller.mintOperations(0)
            assert.equal(mintOperation[4],true)
            await this.multisigOwner.unpauseMint(0,  {from: owner1})
            await this.multisigOwner.unpauseMint(0,  {from: owner2})
            mintOperation = await this.controller.mintOperations(0)
            assert.equal(mintOperation[4],false)
        })

        it('owner invalidate past request mints', async function(){
            await this.multisigOwner.requestMint(oneHundred, 10*10**18, {from: owner1})
            await this.multisigOwner.requestMint(oneHundred, 10*10**18, {from: owner2})
            await this.multisigOwner.requestMint(oneHundred, 20*10**18, {from: owner1})
            await this.multisigOwner.requestMint(oneHundred, 20*10**18, {from: owner2})
            await this.multisigOwner.invalidateAllPendingMints({from: owner1})
            await this.multisigOwner.invalidateAllPendingMints({from: owner2})
            const invalidateBefore = await this.controller.mintReqInValidBeforeThisBlock()
            assert.isAbove(invalidateBefore, 0)

        })

        it('owner request and ratify a large mint', async function(){
            await this.multisigOwner.requestMint(oneHundred, 30000*10**18, {from: owner1})
            await this.multisigOwner.requestMint(oneHundred, 30000*10**18, {from: owner2})
            await this.multisigOwner.ratifyMint(0, oneHundred, 30000*10**18,  {from: owner1})
            await this.multisigOwner.ratifyMint(0, oneHundred, 30000*10**18, {from: owner2})
            await assertBalance(this.token, oneHundred, 30100*10**18)
        })

        it('owners can revoke mint', async function(){
            await this.multisigOwner.requestMint(oneHundred, 10*10**18,  {from: owner1})
            await this.multisigOwner.requestMint(oneHundred, 10*10**18, {from: owner2})
            await this.multisigOwner.revokeMint(0, {from: owner1})
            await this.multisigOwner.revokeMint(0, {from: owner3})
            const mintOperation = await this.controller.mintOperations(0)
            assert.equal(mintOperation[0],0x0000000000000000000000000000000000000000)
            assert.equal(Number(mintOperation[1]),0)
        })
    })
})