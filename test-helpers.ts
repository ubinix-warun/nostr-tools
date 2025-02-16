import { Server } from 'mock-socket'

import { finalizeEvent, type Event, getPublicKey, generateSecretKey } from './pure.ts'
import { matchFilters, type Filter } from './filter.ts'

export function buildEvent(params: Partial<Event>): Event {
  return {
    id: '',
    kind: 1,
    pubkey: '',
    created_at: 0,
    content: '',
    tags: [],
    sig: '',
    ...params,
  }
}

let serial = 0

export class MockRelay {
  private _server: Server

  public url: string
  public secretKeys: Uint8Array[]
  public preloadedEvents: Event[]

  constructor(url?: string | undefined) {
    serial++
    this.url = url ?? `wss://random.mock.relay/${serial}`
    this.secretKeys = [generateSecretKey(), generateSecretKey(), generateSecretKey(), generateSecretKey()]
    this.preloadedEvents = this.secretKeys.map(sk =>
      finalizeEvent(
        {
          kind: 1,
          content: '',
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
        },
        sk,
      ),
    )

    this._server = new Server(this.url)
    this._server.on('connection', (conn: any) => {
      let subs: { [subId: string]: { conn: any; filters: Filter[] } } = {}

      conn.on('message', (message: string) => {
        const data = JSON.parse(message)

        switch (data[0]) {
          case 'REQ': {
            let subId = data[1]
            let filters = data.slice(2)
            subs[subId] = { conn, filters }

            this.preloadedEvents.forEach(event => {
              conn.send(JSON.stringify(['EVENT', subId, event]))
            })

            filters.forEach((filter: Filter) => {
              const kinds = filter.kinds?.length ? filter.kinds : [1]

              kinds.forEach(kind => {
                this.secretKeys.forEach(sk => {
                  const event = finalizeEvent(
                    {
                      kind,
                      content: '',
                      created_at: Math.floor(Date.now() / 1000),
                      tags: [],
                    },
                    sk,
                  )

                  conn.send(JSON.stringify(['EVENT', subId, event]))
                })
              })
            })

            conn.send(JSON.stringify(['EOSE', subId]))

            break
          }
          case 'CLOSE': {
            let subId = data[1]
            delete subs[subId]

            break
          }
          case 'EVENT': {
            let event = data[1]

            conn.send(JSON.stringify(['OK', event.id, 'true']))

            for (let subId in subs) {
              const { filters, conn: listener } = subs[subId]

              if (matchFilters(filters, event)) {
                listener.send(JSON.stringify(['EVENT', subId, event]))
              }
            }

            break
          }
        }
      })
    })
  }

  get authors() {
    return this.secretKeys.map(getPublicKey)
  }

  get ids() {
    return this.preloadedEvents.map(evt => evt.id)
  }
}
