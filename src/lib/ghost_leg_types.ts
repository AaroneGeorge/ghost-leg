/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/ghost_leg.json`.
 */
export type GhostLeg = {
  "address": "DhS45bjZe13UqRbdoJZx5WK8rxmhG5VspmAUZU9F2yG8",
  "metadata": {
    "name": "ghostLeg",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Ghost Leg: a real-time ladder-lottery brawl on MagicBlock Ephemeral Rollups + VRF"
  },
  "instructions": [
    {
      "name": "addRung",
      "docs": [
        "The frenzy: a rung between column `gap` and `gap + 1`, appended at the bottom."
      ],
      "discriminator": [
        143,
        141,
        227,
        18,
        178,
        184,
        64,
        44
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "game.host",
                "account": "game"
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "gap",
          "type": "u8"
        }
      ]
    },
    {
      "name": "arm",
      "docs": [
        "Musical chairs: once the danger zone has played MIN_DANGER_SECS, any player asks VRF when the",
        "music stops. The callback picks 0..=(SNIPE_WINDOW_SECS - MIN_DANGER_SECS) more seconds."
      ],
      "discriminator": [
        230,
        51,
        249,
        116,
        166,
        65,
        21,
        70
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "game.host",
                "account": "game"
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": "u8"
        }
      ]
    },
    {
      "name": "armCallback",
      "discriminator": [
        97,
        97,
        92,
        21,
        105,
        119,
        154,
        32
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "signer": true,
          "address": "Eo4mARwrf5fUKD8shPMJBSRugDTeu6eTKkUqWVudaRYR"
        },
        {
          "name": "game",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "cancel",
      "docs": [
        "Host closes an unstarted table: every player gets their full deposit back.",
        "remaining_accounts = player wallets, in join order."
      ],
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "host",
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "game.host",
                "account": "game"
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createGame",
      "discriminator": [
        124,
        69,
        75,
        66,
        184,
        220,
        72,
        206
      ],
      "accounts": [
        {
          "name": "host",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "host"
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "rungPrice",
          "type": "u64"
        },
        {
          "name": "rungBudget",
          "type": "u16"
        },
        {
          "name": "durationSecs",
          "type": "u16"
        }
      ]
    },
    {
      "name": "delegateGame",
      "docs": [
        "Host hands the game to the ephemeral rollup. Optional remaining account: validator identity."
      ],
      "discriminator": [
        116,
        183,
        70,
        107,
        112,
        223,
        122,
        210
      ],
      "accounts": [
        {
          "name": "host",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                188,
                167,
                205,
                151,
                242,
                126,
                136,
                120,
                103,
                155,
                152,
                206,
                12,
                190,
                166,
                77,
                209,
                158,
                7,
                192,
                27,
                243,
                28,
                89,
                118,
                53,
                11,
                64,
                92,
                125,
                71,
                21
              ]
            }
          }
        },
        {
          "name": "delegationRecordGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "host"
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "DhS45bjZe13UqRbdoJZx5WK8rxmhG5VspmAUZU9F2yG8"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finish",
      "docs": [
        "After the bell, anyone in the game asks VRF where the ladder gets cut."
      ],
      "discriminator": [
        67,
        74,
        170,
        132,
        125,
        233,
        182,
        37
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "game.host",
                "account": "game"
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": "u8"
        }
      ]
    },
    {
      "name": "finishCallback",
      "discriminator": [
        38,
        209,
        220,
        253,
        5,
        183,
        221,
        190
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "signer": true,
          "address": "Eo4mARwrf5fUKD8shPMJBSRugDTeu6eTKkUqWVudaRYR"
        },
        {
          "name": "game",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "join",
      "discriminator": [
        206,
        55,
        2,
        106,
        113,
        220,
        17,
        163
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "game.host",
                "account": "game"
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "sessionKey",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "session",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "payout",
      "docs": [
        "Pays every player from the game PDA. remaining_accounts = player wallets, in join order."
      ],
      "discriminator": [
        149,
        140,
        194,
        236,
        174,
        189,
        6,
        239
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "game.host",
                "account": "game"
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "settleAndUndelegate",
      "docs": [
        "Commit the settled game back to Solana and release the delegation."
      ],
      "discriminator": [
        169,
        143,
        70,
        235,
        249,
        1,
        119,
        52
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "game.host",
                "account": "game"
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "start",
      "docs": [
        "Any player (wallet or session key) asks VRF for the prize layout."
      ],
      "discriminator": [
        62,
        15,
        117,
        236,
        47,
        1,
        89,
        139
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  104,
                  111,
                  115,
                  116,
                  108,
                  101,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "game.host",
                "account": "game"
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": "u8"
        }
      ]
    },
    {
      "name": "startCallback",
      "discriminator": [
        151,
        163,
        156,
        139,
        223,
        227,
        161,
        208
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "signer": true,
          "address": "Eo4mARwrf5fUKD8shPMJBSRugDTeu6eTKkUqWVudaRYR"
        },
        {
          "name": "game",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "game",
      "discriminator": [
        27,
        90,
        166,
        125,
        74,
        100,
        121,
        18
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "badConfig",
      "msg": "Bad game config"
    },
    {
      "code": 6001,
      "name": "wrongStatus",
      "msg": "Wrong game status for this action"
    },
    {
      "code": 6002,
      "name": "gameFull",
      "msg": "Game is full"
    },
    {
      "code": 6003,
      "name": "alreadyJoined",
      "msg": "Wallet or session already joined"
    },
    {
      "code": 6004,
      "name": "badSession",
      "msg": "Session account does not match"
    },
    {
      "code": 6005,
      "name": "notHost",
      "msg": "Only the host can do this"
    },
    {
      "code": 6006,
      "name": "notEnoughPlayers",
      "msg": "Need at least two players"
    },
    {
      "code": 6007,
      "name": "notPlayer",
      "msg": "Signer is not a player in this game"
    },
    {
      "code": 6008,
      "name": "roundOver",
      "msg": "Round is over"
    },
    {
      "code": 6009,
      "name": "roundNotOver",
      "msg": "Round is still running"
    },
    {
      "code": 6010,
      "name": "badGap",
      "msg": "Rung gap out of range"
    },
    {
      "code": 6011,
      "name": "ladderFull",
      "msg": "Ladder is full"
    },
    {
      "code": 6012,
      "name": "outOfRungs",
      "msg": "No rungs left in your budget"
    },
    {
      "code": 6013,
      "name": "badAccounts",
      "msg": "Remaining accounts do not match players"
    },
    {
      "code": 6014,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6015,
      "name": "tooEarly",
      "msg": "The danger zone has not played long enough yet"
    }
  ],
  "types": [
    {
      "name": "game",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "host",
            "type": "pubkey"
          },
          {
            "name": "gameId",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "rungPrice",
            "type": "u64"
          },
          {
            "name": "rungBudget",
            "type": "u16"
          },
          {
            "name": "durationSecs",
            "type": "u16"
          },
          {
            "name": "nPlayers",
            "type": "u8"
          },
          {
            "name": "players",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "playerSlot"
                  }
                },
                6
              ]
            }
          },
          {
            "name": "prizeBps",
            "docs": [
              "prize share (bps) sitting at the bottom of each slot"
            ],
            "type": {
              "array": [
                "u16",
                6
              ]
            }
          },
          {
            "name": "ends",
            "docs": [
              "ends[slot] = player index whose path currently lands on that slot"
            ],
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "cutoff",
            "type": "u16"
          },
          {
            "name": "startRandomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "cutRandomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pot",
            "type": "u64"
          },
          {
            "name": "rungs",
            "type": {
              "vec": {
                "defined": {
                  "name": "rung"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "playerSlot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "rungsUsed",
            "type": "u16"
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rung",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gap",
            "type": "u8"
          },
          {
            "name": "player",
            "type": "u8"
          },
          {
            "name": "t",
            "docs": [
              "seconds since the round started"
            ],
            "type": "u16"
          }
        ]
      }
    }
  ]
};
