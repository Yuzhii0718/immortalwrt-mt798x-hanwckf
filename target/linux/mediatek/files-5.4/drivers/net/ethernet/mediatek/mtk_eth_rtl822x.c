// SPDX-License-Identifier: GPL-2.0-only
/*
 *
 *   Copyright (C) 2009-2016 John Crispin <blogic@openwrt.org>
 *   Copyright (C) 2009-2016 Felix Fietkau <nbd@openwrt.org>
 *   Copyright (C) 2013-2016 Michael Lee <igvtee@gmail.com>
 */

#include <linux/of_device.h>
#include <linux/of_mdio.h>
#include <linux/of_net.h>
#include <linux/mfd/syscon.h>
#include <linux/regmap.h>
#include <linux/clk.h>
#include <linux/pm_runtime.h>
#include <linux/if_vlan.h>
#include <linux/reset.h>
#include <linux/tcp.h>
#include <linux/interrupt.h>
#include <linux/mdio.h>
#include <linux/pinctrl/devinfo.h>
#include <linux/phylink.h>
#include <net/dsa.h>
#include <linux/of_platform.h>
#include <linux/of_gpio.h>
#include <linux/of_irq.h>
#include "mtk_eth_soc.h"
#include "mtk_eth_dbg.h"
#include "mtk_eth_reset.h"


#include "mtk_hnat/nf_hnat_mtk.h"
#include "rtl822x/rtl_adapter.h"
#include "rtl822x/rtl8226_typedef.h"
#include "rtl822x/nic_rtl8226b_init.h"
static struct mtk_eth *sg_eth;

int mtk_mmd_read(struct mtk_eth *eth, int addr, int devad, u16 reg)
{
	int val;

    mutex_lock(&eth->mii_bus->mdio_lock);
	val = _mtk_mdio_read(eth, addr, mdiobus_c45_addr(devad, reg));
    mutex_unlock(&eth->mii_bus->mdio_lock);

    return val;
}

void mtk_mmd_write(struct mtk_eth *eth, int addr, int devad, u16 reg,
              u16 val)
{
    mutex_lock(&eth->mii_bus->mdio_lock);
	_mtk_mdio_write(eth, addr, mdiobus_c45_addr(devad, reg), val);
    mutex_unlock(&eth->mii_bus->mdio_lock);
}

struct mtk_extphy_id {
	u32 phy_id;
	u32 phy_id_mask;
	bool is_c45;
	int (*init)(struct mtk_eth *eth, int addr);
};

u32 mtk_cl45_ind_read(struct mtk_eth *eth, u16 port, u16 devad, u16 reg, u16 *data)
{
        mutex_lock(&eth->mii_bus->mdio_lock);
        _mtk_mdio_write(eth, port, MII_MMD_ACC_CTL_REG, devad);
        _mtk_mdio_write(eth, port, MII_MMD_ADDR_DATA_REG, reg);
        _mtk_mdio_write(eth, port, MII_MMD_ACC_CTL_REG, MMD_OP_MODE_DATA | devad);
        *data = _mtk_mdio_read(eth, port, MII_MMD_ADDR_DATA_REG);
        mutex_unlock(&eth->mii_bus->mdio_lock);
        return 0;
}

u32 mtk_cl45_ind_write(struct mtk_eth *eth, u16 port, u16 devad, u16 reg, u16 data)
{
        mutex_lock(&eth->mii_bus->mdio_lock);
        _mtk_mdio_write(eth, port, MII_MMD_ACC_CTL_REG, devad);
        _mtk_mdio_write(eth, port, MII_MMD_ADDR_DATA_REG, reg);
        _mtk_mdio_write(eth, port, MII_MMD_ACC_CTL_REG, MMD_OP_MODE_DATA | devad);
        _mtk_mdio_write(eth, port, MII_MMD_ADDR_DATA_REG, data);
        mutex_unlock(&eth->mii_bus->mdio_lock);
        return 0;
}

int mtk_soc_mmd_read(int phyad, int devad, int regad)
{
    struct mtk_eth *eth = sg_eth;
    return mtk_mmd_read(eth, phyad, devad, regad);
}

void mtk_soc_mmd_write(int phyad, int devad, int regad, int val)
{
    struct mtk_eth *eth = sg_eth;
    mtk_mmd_write(eth, phyad, devad, regad, val);
}

static int rtl822x_init(struct mtk_eth *eth, int addr)
{
	u32 val;
	
	val = mtk_mmd_read(eth, addr, 30, 0x75F3);
	val &= ~(1 << 0);
	mtk_mmd_write(eth, addr, 30, 0x75F3, val);

	val = mtk_mmd_read(eth, addr, 30, 0x697A);
	val &= ~(0x3F);
	val |= 0x2;
	val |= (1 << 15);
	mtk_mmd_write(eth, addr, 30, 0x697A, val);

	msleep(500);

	val = mtk_mmd_read(eth, addr, 7, 0);
	val |= (1 << 9);
	mtk_mmd_write(eth, addr, 7, 0, val);

    msleep(500);

	// led0 at 10/100/1000/2.5G
	mtk_mmd_write(eth, addr, 31, 0xd032, 0x0027);
	// led on time = 400ms, duty = 12.5%, freq = 60ms, Enable 10M LPI, modeA, act
	mtk_mmd_write(eth, addr, 31, 0xd040, 0x321f);
	// all led enable, polar = low
	mtk_mmd_write(eth, addr, 31, 0xd044, 0xf8);

	msleep(500);
    	
	dev_info(eth->dev, "RTL822x init success!\n");

	Rtl8226b_phy_init((HANDLE){eth, addr}, NULL, 1);

	return 0;
}

static struct mtk_extphy_id extphy_tbl[] = {
	{0x001CC840, 0x0fffffff0, 1, rtl822x_init},
};

static u32 get_cl22_phy_id(struct mtk_eth *eth, int addr)
{
	int phy_reg;
	u32 phy_id = 0;

	phy_reg = _mtk_mdio_read(eth, addr, MII_PHYSID1);
	if (phy_reg < 0)
		return 0;
	phy_id = (phy_reg & 0xffff) << 16;

	/* Grab the bits from PHYIR2, and put them in the lower half */
	phy_reg = _mtk_mdio_read(eth, addr, MII_PHYSID2);
	if (phy_reg < 0)
		return 0;

	phy_id |= (phy_reg & 0xffff);

	return phy_id;
}

static u32 get_cl45_phy_id(struct mtk_eth *eth, int addr)
{
	u16 phy_reg;
	u32 phy_id = 0;

	mtk_cl45_ind_read(eth, addr, 1, MII_PHYSID1, &phy_reg);
	if (phy_reg < 0)
		return 0;
	phy_id = (phy_reg & 0xffff) << 16;

	/* Grab the bits from PHYIR2, and put them in the lower half */
	mtk_cl45_ind_read(eth, addr, 1, MII_PHYSID2, &phy_reg);
	if (phy_reg < 0)
		return 0;

	phy_id |= (phy_reg & 0xffff);

	return phy_id;
}

static inline bool phy_id_is_match(u32 id, struct mtk_extphy_id *phy)
{
	return ((id & phy->phy_id_mask) == (phy->phy_id & phy->phy_id_mask));
}

int mtk_soc_extphy_init(struct mtk_eth *eth, int addr)
{
	int i;
	u32 phy_id;
	struct mtk_extphy_id *extphy;

	for (i = 0; i < ARRAY_SIZE(extphy_tbl); i++)
	{
		extphy = &extphy_tbl[i];
		if (extphy->is_c45)
		{	
			phy_id = get_cl45_phy_id(eth, addr);
		
		}
		else
		{	
			phy_id = get_cl22_phy_id(eth, addr);
			
		}

		if (phy_id_is_match(phy_id, extphy))
			{extphy->init(eth, addr);}
		
	 	
	}

	return 0;
}
