const RegistryMock = artifacts.require("RegistryMock")
const Registry = artifacts.require('Registry')
const TrueUSDMock = artifacts.require("TrueUSDMock")
const TrueUSD = artifacts.require("TrueUSD")
const BalanceSheet = artifacts.require("BalanceSheet")
const AllowanceSheet = artifacts.require("AllowanceSheet")
const OwnedUpgradeabilityProxy = artifacts.require("OwnedUpgradeabilityProxy")


const bytes32 = require('./helpers/bytes32.js');
const BN = web3.utils.toBN;
const fs = require('fs')

let profile;
try {
    profile = require('../GasProfile.json') || {};
} catch (error) {
    console.error(error);
    console.log('Creating GasProfile.json')
    profile = {}
}

function showRegressions(results) {
    for (let trial in results) {
        showRegression(trial, results[trial].actual);
    }
}

function showRegression(type, actual) {
    const expected = profile[type];
    if (actual < expected) {
        console.log("\x1b[32m", type, "improvement:", expected, '->', actual, "\x1b[0m");
    } else if (actual > expected) {
        console.log("\x1b[31m", type, "regression:", expected, '->', actual, "\x1b[0m");
    } else if (typeof(expected) === 'undefined') {
        console.log(type, '=', actual)
    }
    profile[type] = actual
}

function hasNoZero(address) {
    for (let i = 2; i < address.length; i++) {
        if (address.substr(i, 2) == '00') {
            return false
        }
    }
    return true
}

contract('GasProfile', function (accounts) {

    describe('--Gas Profiling--', function () {
        const DOLLAR = BN(1*10**18);
        const BURN_ADDRESS = '0x0000000000000000000000000000000000011111';
        const [_, owner, oneHundred, anotherAccount] = accounts.filter(hasNoZero)
        beforeEach(async function () {
            this.balances = await BalanceSheet.new({ from: owner })
            this.allowances = await AllowanceSheet.new({ from: owner })
            this.tokenProxy = await OwnedUpgradeabilityProxy.new({from: owner});
            this.tokenMockImpl = await TrueUSDMock.new(owner, 0);
            this.tokenImpl = await TrueUSD.new()
            this.registryProxy = await OwnedUpgradeabilityProxy.new({from: owner});
            this.registryImpl = await Registry.new({ from: owner })
            this.registryMockImpl = await RegistryMock.new({ from: owner })

            await this.tokenProxy.upgradeTo(this.tokenMockImpl.address, {from:owner});
            this.tokenMock = await TrueUSDMock.at(this.tokenProxy.address);
            await this.tokenMock.initialize({from: owner});
            this.token = await TrueUSD.at(this.tokenProxy.address);

            await this.tokenProxy.upgradeTo(this.tokenImpl.address, {from: owner});
            await this.registryProxy.upgradeTo(this.registryMockImpl.address, {from: owner});
            this.registryMock = await RegistryMock.at(this.registryProxy.address);
            await this.registryMock.initialize({ from: owner });
            await this.registryProxy.upgradeTo(this.registryImpl.address, { from: owner });
            this.registry = await Registry.at(this.registryProxy.address);

            await this.token.setRegistry(this.registry.address, { from: owner })
            await this.balances.transferOwnership(this.token.address, { from: owner })
            await this.allowances.transferOwnership(this.token.address, { from: owner })
            await this.token.setBalanceSheet(this.balances.address, { from: owner })
            await this.token.setAllowanceSheet(this.allowances.address, { from: owner })

            await this.registry.setAttributeValue(oneHundred, bytes32("hasPassedKYC/AML"), 1, { from: owner })
            await this.token.mint(oneHundred, BN(100*10**18), { from: owner })
            await this.registry.setAttributeValue(oneHundred, bytes32("hasPassedKYC/AML"), 0, { from: owner })
            await this.registry.setAttributeValue(oneHundred, bytes32("canSetFutureRefundMinGasPrice"), 1, { from: owner });

            await this.registry.setAttributeValue(BURN_ADDRESS, bytes32("canBurn"), 1, {from: owner})
            await this.token.setBurnBounds(BN(1), BN(1000).mul(BN(10**18)), {from: owner});
        })

        describe('without refund', function() {
            it('transfer', async function(){
                const reduceToNewNoRefund = await this.token.transfer(anotherAccount, DOLLAR, { from: oneHundred });
                const reduceToExistingNoRefund = await this.token.transfer(anotherAccount, DOLLAR, { from: oneHundred });
                const emptyToExistingNoRefund = await this.token.transfer(anotherAccount, BN(98*10**18), { from: oneHundred });
                const emptyToNewNoRefund = await this.token.transfer(oneHundred, BN(100*10**18), { from: anotherAccount });
                const expectations = {
                    reduceToNewNoRefund: { actual: reduceToNewNoRefund.receipt.gasUsed },
                    reduceToExistingNoRefund: { actual: reduceToExistingNoRefund.receipt.gasUsed },
                    emptyToExistingNoRefund: { actual: emptyToExistingNoRefund.receipt.gasUsed },
                    emptyToNewNoRefund: { actual: emptyToNewNoRefund.receipt.gasUsed },
                };
                showRegressions(expectations);
            })

            it('transferFrom', async function() {
                const approve50 = await this.token.approve(anotherAccount, BN(50).mul(DOLLAR), { from: oneHundred });
                const reduceApprovalReducingToNew = await this.token.transferFrom(oneHundred, anotherAccount, DOLLAR, { from: anotherAccount, gasPrice: 1 });
                const reduceApprovalReducingToExisting = await this.token.transferFrom(oneHundred, anotherAccount, DOLLAR, { from: anotherAccount, gasPrice: 1 });
                const emptyApprovalReducingToExisting = await this.token.transferFrom(oneHundred, anotherAccount, BN(48).mul(DOLLAR), { from: anotherAccount, gasPrice: 1});
                const approve50b = await this.token.approve(oneHundred, BN(50).mul(DOLLAR), { from: anotherAccount });
                const emptyApprovalEmptyingToExisting = await this.token.transferFrom(anotherAccount, oneHundred, BN(50).mul(DOLLAR), { from: oneHundred, gasPrice: 1});
                const approve1 = await this.token.approve(anotherAccount, DOLLAR, { from: oneHundred, gasPrice: 1});
                const emptyApprovalReducingToNew = await this.token.transferFrom(oneHundred, anotherAccount, DOLLAR, { from: anotherAccount, gasPrice: 1});
                const approve20 = await this.token.approve(oneHundred, BN(20).mul(DOLLAR), { from: anotherAccount, gasPrice: 1 });
                const reduceApprovalEmptyingToExisting = await this.token.transferFrom(anotherAccount, oneHundred, DOLLAR, { from: oneHundred, gasPrice: 1 });
                const approve100 = await this.token.approve(anotherAccount, BN(100).mul(DOLLAR), { from: oneHundred, gasPrice: 1 });
                const emptyApprovalEmptyingToNew = await this.token.transferFrom(oneHundred, anotherAccount, BN(100).mul(DOLLAR), { from: anotherAccount, gasPrice: 1});
                const approve101 = await this.token.approve(oneHundred, BN(101).mul(DOLLAR), { from: anotherAccount, gasPrice: 1 });
                const reduceApprovalEmptyingToNew = await this.token.transferFrom(anotherAccount, oneHundred, BN(100).mul(DOLLAR), { from: oneHundred, gasPrice: 1} );

                const expectations = {
                    reduceApprovalReducingToNew : { actual: reduceApprovalReducingToNew.receipt.gasUsed },
                    reduceApprovalReducingToExisting : { actual: reduceApprovalReducingToExisting.receipt.gasUsed },
                    reduceApprovalEmptyingToNew : { actual: reduceApprovalEmptyingToNew.receipt.gasUsed },
                    reduceApprovalEmptyingToExisting : { actual: reduceApprovalEmptyingToExisting.receipt.gasUsed },
                    emptyApprovalReducingToNew : { actual: emptyApprovalReducingToNew.receipt.gasUsed },
                    emptyApprovalReducingToExisting : { actual: emptyApprovalReducingToExisting.receipt.gasUsed },
                    emptyApprovalEmptyingToNew : { actual: emptyApprovalEmptyingToNew.receipt.gasUsed },
                    emptyApprovalEmptyingToExisting : { actual: emptyApprovalEmptyingToExisting.receipt.gasUsed },
                    approve50: { actual: approve50.receipt.gasUsed },
                };
                showRegressions(expectations);
            })

            it('burn', async function() {
                const reduceToBurn = await this.token.transfer(BURN_ADDRESS, DOLLAR, { from: oneHundred, gasPrice: 1 });
                const emptyToBurn = await this.token.transfer(BURN_ADDRESS, BN(99*10**18), { from: oneHundred, gasPrice: 1});
                const expectations = {
                    reduceToBurn: { actual: reduceToBurn.receipt.gasUsed },
                    emptyToBurn: { actual: emptyToBurn.receipt.gasUsed },
                }
                showRegressions(expectations);
            })
            it('burn with change', async function() {
                const burnMicroDollar = await this.token.transfer(BURN_ADDRESS, BN(10**16).add(BN(10 ** 12)), { from: oneHundred, gasPrice: 1 });
                const reduceToBurnWithChange = await this.token.transfer(BURN_ADDRESS, BN(98*10**18), { from: oneHundred, gasPrice: 1});
                const emptyToBurnWithChange = await this.token.transfer(BURN_ADDRESS, BN(100*10**18).sub(BN(98*10**18)).sub(BN(10**16).add(BN(10**12))), { from: oneHundred, gasPrice: 1 });
                const expectations = {
                    burnMicroDollar: { actual: burnMicroDollar.receipt.gasUsed },
                    reduceToBurnWithChange: { actual: reduceToBurnWithChange.receipt.gasUsed },
                    emptyToBurnWithChange: { actual: emptyToBurnWithChange.receipt.gasUsed },
                }
                showRegressions(expectations);
            })
        })
        describe('with refund', function() {
            beforeEach(async function() {
                await this.token.setMinimumGasPriceForFutureRefunds(1, { from: oneHundred });
                await this.token.sponsorGas({ from: oneHundred });
                await this.token.sponsorGas({ from: owner });
                await this.token.sponsorGas({ from: anotherAccount });
            })
            it('transfer', async function() {
                const reduceToNewWithRefund = await this.token.transfer(anotherAccount, DOLLAR, { from: oneHundred, gasPrice: 2 });
                const reduceToExistingWithRefund = await this.token.transfer(anotherAccount, DOLLAR, { from: oneHundred, gasPrice: 2 });
                const emptyToExistingWithRefund = await this.token.transfer(anotherAccount, BN(98*10**18), { from: oneHundred, gasPrice: 2 });
                const emptyToNewWithRefund = await this.token.transfer(oneHundred, BN(100*10**18), { from: anotherAccount, gasPrice: 2 });
                const expectations = {
                    reduceToNewWithRefund: { actual: reduceToNewWithRefund.receipt.gasUsed },
                    reduceToExistingWithRefund: { actual: reduceToExistingWithRefund.receipt.gasUsed },
                    emptyToExistingWithRefund: { actual: emptyToExistingWithRefund.receipt.gasUsed },
                    emptyToNewWithRefund: { actual: emptyToNewWithRefund.receipt.gasUsed },
                };
                showRegressions(expectations);
            })
            it('transferFrom', async function() {
                const approve50WithRefund = await this.token.approve(anotherAccount, BN(50).mul(DOLLAR), { from: oneHundred });
                const reduceApprovalReducingToNewWithRefund = await this.token.transferFrom(oneHundred, anotherAccount, DOLLAR, { from: anotherAccount, gasPrice: 2 });
                const reduceApprovalReducingToExistingWithRefund = await this.token.transferFrom(oneHundred, anotherAccount, DOLLAR, { from: anotherAccount, gasPrice: 2 });
                const emptyApprovalReducingToExistingWithRefund = await this.token.transferFrom(oneHundred, anotherAccount, BN(48).mul(DOLLAR), { from: anotherAccount, gasPrice: 2});
                const approve50bWithRefund = await this.token.approve(oneHundred, BN(50).mul(DOLLAR), { from: anotherAccount });
                const emptyApprovalEmptyingToExistingWithRefund = await this.token.transferFrom(anotherAccount, oneHundred, BN(50).mul(DOLLAR), { from: oneHundred, gasPrice: 2});
                const approve1WithRefund = await this.token.approve(anotherAccount, DOLLAR, { from: oneHundred, gasPrice: 2});
                const emptyApprovalReducingToNewWithRefund = await this.token.transferFrom(oneHundred, anotherAccount, DOLLAR, { from: anotherAccount, gasPrice: 2});
                const approve20WithRefund = await this.token.approve(oneHundred, BN(20).mul(DOLLAR), { from: anotherAccount, gasPrice: 2 });
                const reduceApprovalEmptyingToExistingWithRefund = await this.token.transferFrom(anotherAccount, oneHundred, DOLLAR, { from: oneHundred, gasPrice: 2 });
                const approve100WithRefund = await this.token.approve(anotherAccount, BN(100).mul(DOLLAR), { from: oneHundred, gasPrice: 2 });
                const emptyApprovalEmptyingToNewWithRefund = await this.token.transferFrom(oneHundred, anotherAccount, BN(100).mul(DOLLAR), { from: anotherAccount, gasPrice: 2});
                const approve101WithRefund = await this.token.approve(oneHundred, BN(101).mul(DOLLAR), { from: anotherAccount, gasPrice: 2 });
                const reduceApprovalEmptyingToNewWithRefund = await this.token.transferFrom(anotherAccount, oneHundred, BN(100).mul(DOLLAR), { from: oneHundred, gasPrice: 2} );

                const expectations = {
                    reduceApprovalReducingToNewWithRefund : { actual: reduceApprovalReducingToNewWithRefund.receipt.gasUsed },
                    reduceApprovalReducingToExistingWithRefund : { actual: reduceApprovalReducingToExistingWithRefund.receipt.gasUsed },
                    reduceApprovalEmptyingToNewWithRefund : { actual: reduceApprovalEmptyingToNewWithRefund.receipt.gasUsed },
                    reduceApprovalEmptyingToExistingWithRefund : { actual: reduceApprovalEmptyingToExistingWithRefund.receipt.gasUsed },
                    emptyApprovalReducingToNewWithRefund : { actual: emptyApprovalReducingToNewWithRefund.receipt.gasUsed },
                    emptyApprovalReducingToExistingWithRefund : { actual: emptyApprovalReducingToExistingWithRefund.receipt.gasUsed },
                    emptyApprovalEmptyingToNewWithRefund : { actual: emptyApprovalEmptyingToNewWithRefund.receipt.gasUsed },
                    emptyApprovalEmptyingToExistingWithRefund : { actual: emptyApprovalEmptyingToExistingWithRefund.receipt.gasUsed },
                    approve50WithRefund: { actual: approve50WithRefund.receipt.gasUsed },
                };
                showRegressions(expectations);
            })

            it('burn', async function() {
                const reduceToBurnWithRefund = await this.token.transfer(BURN_ADDRESS, DOLLAR, { from: oneHundred, gasPrice: 2 });
                const emptyToBurnWithRefund = await this.token.transfer(BURN_ADDRESS, BN(99*10**18), { from: oneHundred, gasPrice: 2});
                const expectations = {
                    reduceToBurnWithRefund: { actual: reduceToBurnWithRefund.receipt.gasUsed },
                    emptyToBurnWithRefund: { actual: emptyToBurnWithRefund.receipt.gasUsed },
                }
                showRegressions(expectations);
            })
            it('burn with change', async function() {
                const burnMicroDollarWithRefund = await this.token.transfer(BURN_ADDRESS, BN(10**16).add(BN(10 ** 12)), { from: oneHundred, gasPrice: 2 });
                const reduceToBurnWithChangeWithRefund = await this.token.transfer(BURN_ADDRESS, BN(98*10**18), { from: oneHundred, gasPrice: 2});
                const emptyToBurnWithChangeWithRefund = await this.token.transfer(BURN_ADDRESS, BN(100*10**18).sub(BN(98*10**18)).sub(BN(10**16).add(BN(10**12))), { from: oneHundred, gasPrice: 2 });
                const expectations = {
                    burnMicroDollarWithRefund: { actual: burnMicroDollarWithRefund.receipt.gasUsed },
                    reduceToBurnWithChangeWithRefund: { actual: reduceToBurnWithChangeWithRefund.receipt.gasUsed },
                    emptyToBurnWithChangeWithRefund: { actual: emptyToBurnWithChangeWithRefund.receipt.gasUsed },
                }
                showRegressions(expectations);
            })
        })
        after(function() {
            console.log('Writing GasProfile.json')
            const updatedExpectations = JSON.stringify(profile, null, 2);
            fs.writeFile('../GasProfile.json', updatedExpectations, (error) => {
                if (error) {
                    console.error(error)
                    return
                }
                console.log('Wrote GasProfile.json')
            })
        })
    })
})
