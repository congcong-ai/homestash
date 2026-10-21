#pragma once
#include "hs_board.h"
/* 同一业务在不同板型上使用同一能力判定；缺硬件时交由Web完成。 */
bool hs_device_action_supported(const hs_board_descriptor_t *board, hs_action_t action);
