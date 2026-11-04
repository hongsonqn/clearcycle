/** Entry point: migrate, start the indexer, serve the API. */
import { startApi } from './api'
import { config } from './config'
import { startIndexer } from './indexer'
import { migrate } from './migrate'

const applied = await migrate()
console.log(applied.length ? `db: applied ${applied.join(', ')}` : 'db: schema up to date')
console.log(`chain ${config.chainId}, contract ${config.contract}, rpc source: ${config.rpcSource}`)
startIndexer()
startApi()
