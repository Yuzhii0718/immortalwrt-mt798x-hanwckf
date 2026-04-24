'use strict';
'require baseclass';
'require fs';
'require rpc';
'require network';

let callSwconfigPortState = rpc.declare({
  object: 'luci',
  method: 'getSwconfigPortState',
  params: ['switch'],
  expect: { result: [] }
});

let callLuciBoardJSON = rpc.declare({
  object: 'luci-rpc',
  method: 'getBoardJSON',
  expect: { '': {} }
});

let callLuciETHInfo = rpc.declare({
  object: 'luci-rpc',
  method: 'getETHInfo',
  expect: { '': {} }
});

let callLuciNetworkDevices = rpc.declare({
  object: 'luci-rpc',
  method: 'getNetworkDevices',
  expect: { '': {} }
});

function isLinkUp(link) {
  return link === true || link === 1 || link === 'yes' || link === 'up' || link === 'Up' || link === '1';
}

function isFullDuplex(duplex) {
  return duplex === true || String(duplex).toLowerCase() === 'full';
}

async function getSwitchPortFlow() {
  const portFlow = [];
  const res = await fs.exec('/sbin/swconfig', ['dev', 'switch0', 'show']);
  const lines = (res.stdout || '').trim().split(/\n/);
  let portNum;
  for (let line of lines) {
    let match = line.match(/^Port\s+(\d+):$/);
    if (match != null) {
      portNum = Number(match[1]);
      portFlow[portNum] = {};
      continue;
    }
    match = line.match(/^TxByte\s*:\s*(\d+)$/);
    if (match != null) {
      portFlow[portNum].rxflow = Number(match[1]);
      continue;
    }
    match = line.match(/^RxByte\s*:\s*(\d+)$/);
    if (match != null) {
      portFlow[portNum].txflow = Number(match[1]);
      continue;
    }
  }
  return portFlow;
}

function formatSpeed(speed) {
  if (speed === '-' || speed == null || speed <= 0) return '-';
  const speedInt = parseInt(speed);
  if (isNaN(speedInt)) return '-';
  return speedInt < 1000 ? `${speedInt} M` : `${speedInt / 1000} GbE`;
}

function getPortColor(carrier, duplex) {
  if (!isLinkUp(carrier)) return 'background-color: whitesmoke;';
  return `background-color: ${isFullDuplex(duplex) ? 'greenyellow' : 'darkorange'};`;
}

function getPortIcon(carrier) {
  return L.resource(`icons/port_${isLinkUp(carrier) ? 'up' : 'down'}.png`);
}

function getNetdev(netdevs, ifname) {
  if (!ifname || typeof netdevs !== 'object' || netdevs == null) return null;

  return netdevs[ifname] || netdevs[ifname.toLowerCase()] || netdevs[ifname.toUpperCase()] || null;
}

function pushPort(ports, name, carrier, duplex, speed, txflow, rxflow) {
  const entry = {
    ifname: name,
    carrier: carrier,
    duplex: duplex,
    speed: speed,
    txflow: txflow,
    rxflow: rxflow
  };

  if (name && name.toUpperCase().startsWith('WAN')) ports.unshift(entry);
  else ports.push(entry);
}

function getEthInfoPorts(ethinfo, netdevs) {
  const ports = [];

  for (const port of ethinfo) {
    const ifname = port.name || port.ifname || '';
    const dev = getNetdev(netdevs, ifname);
    const stats = dev?.stats || {};

    pushPort(
      ports,
      ifname,
      port.status ?? port.link ?? dev?.link?.carrier,
      port.duplex ?? dev?.link?.duplex,
      port.speed ?? dev?.link?.speed,
      stats.tx_bytes ?? port.tx_bytes ?? 0,
      stats.rx_bytes ?? port.rx_bytes ?? 0
    );
  }

  return ports;
}

function getPorts(board, netdevs, switches, portflow, ethinfoData) {
  const ports = [];

  const ethinfo = Array.isArray(ethinfoData?.ethinfo) ? ethinfoData.ethinfo : [];
  if (ethinfo.length > 0) return getEthInfoPorts(ethinfo, netdevs);

  if (Object.keys(switches).length === 0) {
    const network = board?.network || {};
    const ifnames = [network?.wan?.device].concat(network?.lan?.ports || []);
    for (const ifname of ifnames) {
      const dev = getNetdev(netdevs, ifname);
      if (!dev) continue;
      ports.push({
        ifname: dev.name,
        carrier: dev.link.carrier,
        duplex: dev.link.duplex,
        speed: dev.link.speed,
        txflow: dev.stats.tx_bytes,
        rxflow: dev.stats.rx_bytes
      });
    }
    return ports;
  }

  let wanInSwitch;
  const switch0 = switches['switch0'];
  if (!switch0 || !Array.isArray(switch0.ports)) return ports;
  const lan = getNetdev(netdevs, 'br-lan');
  const wan = getNetdev(netdevs, board?.network?.wan?.device);
  for (const port of switch0.ports) {
    const label = port.label.toUpperCase();
    const portstate = switch0.portstate[port.num];
    portstate.ifname = label;
    portstate.carrier = portstate.link;
    if (portflow[port.num]) {
      portstate.txflow = portflow[port.num].txflow;
      portstate.rxflow = portflow[port.num].rxflow;
    }
    if (label.startsWith('WAN')) {
      wanInSwitch = true;
      if (!portstate.rxflow && wan) {
        portstate.txflow = wan.stats.tx_bytes;
        portstate.rxflow = wan.stats.rx_bytes;
      }
      ports.unshift(portstate);
    } else if (label.startsWith('LAN')) {
      if (!portstate.rxflow && lan) {
        portstate.txflow = lan.stats.tx_bytes;
        portstate.rxflow = lan.stats.rx_bytes;
      }
      ports.push(portstate);
    }
  }
  if (wanInSwitch) return ports;

  if (wan) {
    ports.unshift({
      ifname: 'WAN',
      carrier: wan.link.carrier,
      duplex: wan.link.duplex,
      speed: wan.link.speed,
      txflow: wan.stats.tx_bytes,
      rxflow: wan.stats.rx_bytes
    });
  }
  return ports;
}

function renderPorts(data) {
  const css = {
    grids: `
      display: grid; grid-gap: 5px 10px;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      margin-bottom: 1em;
    `,
    head: `
      color: Black;
      text-align: center;
      font-weight: bold;
      border-radius: 7px 7px 0 0;
    `,
    body: `
      border: 1px solid lightgrey;
      border-radius: 0 0 7px 7px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;`,
    icon: 'margin: 5px; width: 32px;',
    speed: 'font-size: 0.8rem; font-weight: bold;',
    flow: `
      border-top: 1px solid lightgrey;
      font-size: 0.8rem;`
  };

  const ports = [];
  getPorts(...data).forEach((port) => {
    const { carrier, duplex } = port;
    const ifname = String(port.ifname || '').replace(/\s+/g, '');
    ports.push(
      E('div', {}, [
        E('div', { style: css.head + getPortColor(carrier, duplex) }, ifname),
        E('div', { style: css.body }, [
          E('img', { style: css.icon, src: getPortIcon(carrier) }),
          E('div', { style: css.speed }, formatSpeed(port.speed)),
          E('div', { style: css.flow }, [
            '\u25b2\u202f%1024.1mB'.format(carrier ? port.txflow : 0),
            E('br'),
            '\u25bc\u202f%1024.1mB'.format(carrier ? port.rxflow : 0)
          ])
        ])
      ])
    );
  });

  return E('div', { style: css.grids }, ports);
}

return baseclass.extend({
  title: _('Ethernet Information'),

  load: function () {
    const switchTopologies = network.getSwitchTopologies();

    return Promise.all([
      L.resolveDefault(callLuciBoardJSON(), {}),
      L.resolveDefault(callLuciNetworkDevices(), {}),
      switchTopologies.then(async (topologies) => {
        if (Object.keys(topologies).length === 0) return {};
        if (topologies['switch0']) {
          topologies['switch0'].portstate = await L.resolveDefault(callSwconfigPortState('switch0'), []);
        }
        return topologies;
      }),
      switchTopologies.then(async (topologies) => {
        if (Object.keys(topologies).length === 0) return [];
        return await getSwitchPortFlow();
      }),
      L.resolveDefault(callLuciETHInfo(), {})
    ]);
  },

  render: function (data) {
    return renderPorts(data);
  }
});
