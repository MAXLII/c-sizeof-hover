#include <stdint.h>

#define __IO volatile
#define __IM volatile const
#define __OM volatile

typedef struct {
    __IO uint32_t CR;
    __IO uint32_t SR;
    __IO uint32_t DR;
} M0P_USART_TypeDef;

#define M0P_USART_BASE 0x40030000UL
#define M0P_USART ((M0P_USART_TypeDef *)M0P_USART_BASE)

typedef struct {
    __IO uint32_t DIR;
    __IO uint32_t OUT;
    __IM  uint32_t IN;
} M0P_GPIO_TypeDef;

M0P_USART_TypeDef usart_local;
M0P_GPIO_TypeDef *gpio;

void init_usart(void) {
    uint32_t temp = usart_local.CR;
    uint32_t dir = M0P_USART->SR;
    uint32_t gpio_in = gpio->IN;
}
